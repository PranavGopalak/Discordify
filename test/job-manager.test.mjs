import assert from 'node:assert/strict';
import test from 'node:test';

import { JobManager } from '../lib/job-manager.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function message(id, overrides = {}) {
  return {
    id,
    channel_id: overrides.channel_id ?? 'channel-1',
    type: 0,
    pinned: false,
    content: `message ${id}`,
    attachments: [],
    author: { id: 'user-1', username: 'tester', discriminator: '0' },
    ...overrides,
  };
}

function bulkPayload(overrides = {}) {
  return {
    token: 'test-token',
    authorId: 'user-1',
    scopeMode: 'selected',
    guildId: 'guild-1',
    channelIds: '',
    searchDelay: 100,
    deleteDelay: 50,
    maxAttempt: 1,
    ...overrides,
  };
}

function createSearchClient(initialMessages, options = {}) {
  const remaining = initialMessages.slice();
  const searches = [];
  const deleteCalls = [];
  const pageSize = options.pageSize ?? 3;

  return {
    remaining,
    searches,
    deleteCalls,
    searchMessages(query) {
      const offset = Number(query.offset ?? 0);
      searches.push(offset);
      const page = remaining.slice(offset, offset + pageSize);
      return Promise.resolve(jsonResponse({
        total_results: remaining.length,
        messages: page.map((entry) => [{ ...entry, hit: true }]),
      }));
    },
    deleteMessage(_channelId, messageId) {
      deleteCalls.push(messageId);
      if (options.failIds?.has(messageId)) {
        return Promise.resolve(jsonResponse({ message: 'Forbidden' }, 403));
      }

      const index = remaining.findIndex((entry) => entry.id === messageId);
      if (index >= 0) remaining.splice(index, 1);
      return Promise.resolve(emptyResponse());
    },
  };
}

async function runBulkWith(client, payload = bulkPayload()) {
  const manager = new JobManager({
    clientFactory: () => client,
    waitFn: async () => {},
  });
  const job = manager.createBulkJob(payload);
  await job.runPromise;
  return job.snapshot();
}

test('bulk sweep deletes every eligible message while advancing past retained filters', async () => {
  const pinned = message('pinned', { pinned: true });
  const client = createSearchClient([
    pinned,
    message('one'),
    message('two'),
    message('three'),
    message('four'),
  ]);

  const snapshot = await runBulkWith(client);

  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.progress.deleted, 4);
  assert.equal(snapshot.progress.failed, 0);
  assert.deepEqual(client.remaining.map((entry) => entry.id), ['pinned']);
  assert.deepEqual(client.searches, [0, 1, 1]);
});

test('a permanently retained failure does not prevent later messages from being deleted', async () => {
  const client = createSearchClient(
    [message('blocked'), message('one'), message('two'), message('three')],
    { pageSize: 2, failIds: new Set(['blocked']) }
  );

  const snapshot = await runBulkWith(client);

  assert.equal(snapshot.progress.deleted, 3);
  assert.equal(snapshot.progress.failed, 1);
  assert.deepEqual(client.remaining.map((entry) => entry.id), ['blocked']);
  assert.equal(client.deleteCalls.filter((id) => id === 'blocked').length, 1);
  assert.ok(client.searches.length < 6, 'the sweep must terminate instead of looping');
});

test('an archived thread is reopened once and the message delete is retried', async () => {
  let archived = true;
  let unarchiveCalls = 0;
  let deleteCalls = 0;
  const client = {
    deleteMessage() {
      deleteCalls += 1;
      return Promise.resolve(
        archived
          ? jsonResponse({ code: 50083, message: 'Thread is archived' }, 400)
          : emptyResponse()
      );
    },
    unarchiveThread() {
      unarchiveCalls += 1;
      archived = false;
      return Promise.resolve(jsonResponse({ archived: false }));
    },
  };
  const manager = new JobManager({ clientFactory: () => client, waitFn: async () => {} });
  const job = manager.createDirectJob({
    token: 'test-token',
    targets: [{ channelId: 'thread-1', messageId: 'message-1', guildId: 'guild-1' }],
    deleteDelay: 50,
    maxAttempt: 1,
  });

  await job.runPromise;
  const snapshot = job.snapshot();

  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.progress.deleted, 1);
  assert.equal(snapshot.progress.failed, 0);
  assert.equal(job.payload.token, '');
  assert.equal(unarchiveCalls, 1);
  assert.equal(deleteCalls, 2);
});

test('bulk sweeps require a validated author ID', () => {
  const manager = new JobManager({ clientFactory: () => ({}) });
  assert.throws(
    () => manager.createBulkJob(bulkPayload({ authorId: '' })),
    /Validate the Discord account/
  );
});

test('Discord rate limit waits once for retry_after and then resumes', async () => {
  const waits = [];
  let searchCalls = 0;
  const client = {
    searchMessages() {
      searchCalls += 1;
      if (searchCalls === 1) return Promise.resolve(jsonResponse({ retry_after: 0.2 }, 429));
      return Promise.resolve(jsonResponse({ total_results: 0, messages: [] }));
    },
  };
  const manager = new JobManager({
    clientFactory: () => client,
    waitFn: async (ms) => waits.push(ms),
  });
  const job = manager.createBulkJob(bulkPayload({ searchDelay: 100 }));

  await job.runPromise;
  const snapshot = job.snapshot();

  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.stats.throttledCount, 1);
  assert.deepEqual(waits, [200]);
});

test('permits only one active preview or deletion job at a time', async () => {
  let searchCalls = 0;
  const client = {
    searchMessages(_query, signal) {
      searchCalls += 1;
      if (searchCalls > 1) {
        return Promise.resolve(jsonResponse({ total_results: 0, messages: [] }));
      }
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const manager = new JobManager({
    clientFactory: () => client,
    waitFn: async () => {},
  });
  const first = manager.createBulkJob(bulkPayload());
  while (searchCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.throws(
    () => manager.createBulkJob(bulkPayload()),
    (error) => error.statusCode === 409 && /already running/i.test(error.message)
  );

  first.stop();
  await first.runPromise;
  assert.equal(first.snapshot().status, 'stopped');
  const afterStop = manager.createBulkJob(bulkPayload());
  await afterStop.runPromise;
  assert.equal(afterStop.snapshot().status, 'completed');
});

test('retains no more than fifty finished jobs', async () => {
  const manager = new JobManager({
    clientFactory: () => ({
      deleteMessage: () => Promise.resolve(emptyResponse()),
    }),
    waitFn: async () => {},
  });

  for (let index = 0; index < 51; index += 1) {
    const job = manager.createDirectJob({
      token: 'test-token',
      targets: [{
        channelId: `channel-${index}`,
        messageId: `message-${index}`,
        guildId: 'guild-1',
      }],
      deleteDelay: 50,
      maxAttempt: 1,
    });
    await job.runPromise;
  }

  assert.equal(manager.listJobs().length, 50);
});
