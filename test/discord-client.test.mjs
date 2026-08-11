import assert from 'node:assert/strict';
import test from 'node:test';

import { DiscordClient } from '../lib/discord-client.mjs';

test('applies an independent deadline to Discord requests', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {
      once: true,
    });
  });

  const client = new DiscordClient('test-token', undefined, {
    requestTimeoutMs: 20,
  });
  const startedAt = Date.now();
  await assert.rejects(client.getCurrentUser(), (error) => error.name === 'TimeoutError');
  assert.ok(Date.now() - startedAt < 1000);
});

test('preserves a caller stop signal while adding the deadline', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {
      once: true,
    });
  });

  const controller = new AbortController();
  const client = new DiscordClient('test-token', undefined, {
    requestTimeoutMs: 1000,
  });
  const request = client.getCurrentUser(controller.signal);
  controller.abort(new Error('stopped by user'));
  await assert.rejects(request, /stopped by user/);
});
