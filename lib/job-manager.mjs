import { randomUUID } from 'node:crypto';

import { DiscordClient } from './discord-client.mjs';
import {
  clampNumber,
  coerceBoolean,
  createPublicConfig,
  describeMessage,
  filterCandidateMessages,
  msToHMS,
  parseChannelIds,
  parseMessageTargets,
  pickHitMessages,
  safeTrim,
  toSnowflake,
  wait,
} from './helpers.mjs';

const MAX_LOG_ENTRIES = 400;
const BULK_SCOPE_MODES = new Set(['selected', 'all-dms', 'all-servers', 'all-sources']);

function parseResponseText(responseText) {
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function formatGuildLabel(guild) {
  const name = safeTrim(guild?.name);
  return name ? `server ${name} (${guild.id})` : `server ${guild.id}`;
}

function formatPrivateChannelLabel(channel) {
  const recipients = Array.isArray(channel?.recipients)
    ? channel.recipients
      .map((recipient) => safeTrim(recipient?.global_name) || safeTrim(recipient?.username) || safeTrim(recipient?.id))
      .filter(Boolean)
    : [];
  const baseName = safeTrim(channel?.name) || recipients.join(', ') || safeTrim(channel?.id) || 'unknown';
  return channel?.type === 3 ? `group DM ${baseName}` : `DM ${baseName}`;
}

function normalizeBulkPayload(payload) {
  const token = safeTrim(payload.token);
  const scopeMode = safeTrim(payload.scopeMode) || 'selected';
  const guildId = safeTrim(payload.guildId);
  const channelIds = parseChannelIds(payload.channelIds ?? payload.channelIdsText);

  if (!token) throw new Error('A Discord authorization token is required.');
  if (!BULK_SCOPE_MODES.has(scopeMode)) {
    throw new Error('Unknown delete scope.');
  }
  if (scopeMode === 'selected' && !guildId) {
    throw new Error('A server or DM scope is required.');
  }
  if (scopeMode === 'selected' && guildId === '@me' && channelIds.length === 0) {
    throw new Error('Custom DM sweeps need at least one DM channel ID or an imported messages/index.json file.');
  }

  return {
    token,
    scopeMode,
    authorId: safeTrim(payload.authorId),
    guildId,
    channelIds,
    content: safeTrim(payload.content),
    hasLink: coerceBoolean(payload.hasLink),
    hasFile: coerceBoolean(payload.hasFile),
    includePinned: coerceBoolean(payload.includePinned),
    includeNsfw: coerceBoolean(payload.includeNsfw),
    pattern: safeTrim(payload.pattern),
    minId: toSnowflake(payload.minId || payload.minDate),
    maxId: toSnowflake(payload.maxId || payload.maxDate),
    searchDelay: clampNumber(payload.searchDelay, 30000, 100, 120000),
    deleteDelay: clampNumber(payload.deleteDelay, 300, 50, 60000),
    maxAttempt: clampNumber(payload.maxAttempt, 2, 1, 10),
    previewOnly: coerceBoolean(payload.previewOnly),
    note: safeTrim(payload.note),
  };
}

function normalizeDirectPayload(payload) {
  const token = safeTrim(payload.token);
  if (!token) throw new Error('A Discord authorization token is required.');

  const parsed =
    Array.isArray(payload.targets) && payload.targets.length > 0
      ? { targets: payload.targets, errors: [] }
      : parseMessageTargets(payload.targetsText);

  if (parsed.targets.length === 0) {
    throw new Error('Add at least one message target or Discord message URL.');
  }

  return {
    token,
    deleteDelay: clampNumber(payload.deleteDelay, 300, 50, 60000),
    maxAttempt: clampNumber(payload.maxAttempt, 2, 1, 10),
    targets: parsed.targets,
    parseErrors: parsed.errors,
    note: safeTrim(payload.note),
  };
}

class DeletionJob {
  constructor(kind, payload) {
    this.id = randomUUID();
    this.kind = kind;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.finishedAt = null;
    this.status = 'queued';
    this.stopRequested = false;
    this.activeController = null;
    this.logSequence = 0;
    this.logs = [];
    this.currentTarget = '';
    this.currentAction = '';

    this.progress = {
      deleted: 0,
      failed: 0,
      skipped: 0,
      scanned: 0,
      matched: 0,
      totalEstimate: 0,
      iterations: 0,
      queueSize: 0,
      queueIndex: 0,
    };

    this.stats = {
      throttledCount: 0,
      throttledTotalTime: 0,
      lastPing: 0,
      avgPing: 0,
      elapsedMs: 0,
    };

    this.startedAtMs = null;
    this.targetEstimates = new Map();
    this.payload = kind === 'bulk' ? normalizeBulkPayload(payload) : normalizeDirectPayload(payload);
    this.client = new DiscordClient(this.payload.token, this);
    this.publicConfig = createPublicConfig(this.payload);
  }

  start() {
    this.startedAtMs = Date.now();
    this.status = 'running';
    this.updatedAt = new Date().toISOString();
    this.runPromise = this.run().catch((error) => {
      if (this.stopRequested) return;
      this.status = 'failed';
      this.finishedAt = new Date().toISOString();
      this.updatedAt = this.finishedAt;
      this.log('error', error instanceof Error ? error.message : String(error));
    });
    return this;
  }

  stop() {
    this.stopRequested = true;
    this.status = 'stopping';
    this.updatedAt = new Date().toISOString();
    if (this.activeController) {
      this.activeController.abort();
    }
    this.log('warn', 'Stop requested. The current request will finish or abort before the job exits.');
  }

  snapshot() {
    this.updateElapsed();
    return {
      id: this.id,
      kind: this.kind,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      finishedAt: this.finishedAt,
      currentTarget: this.currentTarget,
      currentAction: this.currentAction,
      config: this.publicConfig,
      progress: this.progress,
      stats: {
        ...this.stats,
        elapsedLabel: msToHMS(this.stats.elapsedMs),
        throttledLabel: msToHMS(this.stats.throttledTotalTime),
      },
      logs: this.logs,
    };
  }

  recordPing(duration) {
    this.stats.lastPing = duration;
    this.stats.avgPing = this.stats.avgPing > 0
      ? Math.round(this.stats.avgPing * 0.9 + duration * 0.1)
      : duration;
  }

  log(level, message, meta) {
    this.updatedAt = new Date().toISOString();
    const entry = {
      id: ++this.logSequence,
      timestamp: this.updatedAt,
      level,
      message,
      meta,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_ENTRIES);
    }
  }

  updateElapsed() {
    if (this.startedAtMs) {
      this.stats.elapsedMs = Date.now() - this.startedAtMs;
    }
  }

  async withAbort(requestFactory) {
    if (this.stopRequested) throw new Error('Stopped');

    const controller = new AbortController();
    this.activeController = controller;
    try {
      return await requestFactory(controller.signal);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  async coolDown(ms) {
    if (this.stopRequested || ms <= 0) return;
    await wait(ms);
  }

  bumpThrottle(waitMs) {
    this.stats.throttledCount += 1;
    this.stats.throttledTotalTime += waitMs;
  }

  async run() {
    if (this.kind === 'bulk') {
      await this.runBulk();
    } else {
      await this.runDirect();
    }

    if (this.stopRequested) {
      this.status = 'stopped';
      this.log('warn', 'Job stopped.');
    } else if (this.status !== 'failed') {
      this.status = 'completed';
      this.log('success', this.kind === 'bulk' && this.payload.previewOnly
        ? 'Preview finished.'
        : 'Job completed.');
    }

    this.finishedAt = new Date().toISOString();
    this.updatedAt = this.finishedAt;
    this.updateElapsed();
  }

  async runBulk() {
    const targets = await this.resolveBulkTargets();

    this.progress.queueSize = targets.length;
    this.log(
      'info',
      this.payload.previewOnly
        ? `Starting preview across ${targets.length} target(s).`
        : `Starting deletion across ${targets.length} target(s).`
    );

    if (this.payload.note) {
      this.log('debug', `Run note: ${this.payload.note}`);
    }

    for (let index = 0; index < targets.length; index++) {
      if (this.stopRequested) break;

      this.progress.queueIndex = index + 1;
      const target = targets[index];
      this.currentTarget = target.label;
      this.log('info', `Scanning ${target.label} (${index + 1}/${targets.length}).`);
      try {
        await this.runBulkTarget(target);
      } catch (error) {
        this.progress.failed += 1;
        this.log('error', error instanceof Error ? error.message : String(error), {
          target: target.label,
        });
      }
    }
  }

  async resolveBulkTargets() {
    if (this.payload.scopeMode === 'all-dms') {
      return this.loadPrivateChannelTargets();
    }

    if (this.payload.scopeMode === 'all-servers') {
      return this.loadGuildTargets();
    }

    if (this.payload.scopeMode === 'all-sources') {
      const guildTargets = await this.loadGuildTargets();
      const privateTargets = await this.loadPrivateChannelTargets();
      const combined = [...guildTargets, ...privateTargets];
      if (combined.length === 0) {
        throw new Error('No searchable servers or DM conversations were found for this account.');
      }
      return combined;
    }

    if (this.payload.channelIds.length > 0) {
      return this.payload.channelIds.map((channelId) => ({
        key: `${this.payload.guildId}:${channelId}`,
        guildId: this.payload.guildId,
        channelId,
        label:
          this.payload.guildId === '@me'
            ? `DM channel ${channelId}`
            : `channel ${channelId}`,
      }));
    }

    return [{
      key: `${this.payload.guildId}:*`,
      guildId: this.payload.guildId,
      channelId: '',
      label: `server ${this.payload.guildId} (all channels)`,
    }];
  }

  async loadGuildTargets() {
    this.currentAction = 'Loading server list';
    this.log('info', 'Loading the server list for this account.');

    const guilds = [];
    let after = '';

    while (!this.stopRequested) {
      const response = await this.withAbort((signal) =>
        this.client.getGuilds({ limit: 200, after }, signal)
      ).catch((error) => {
        if (this.stopRequested) return null;
        throw error;
      });

      if (!response || this.stopRequested) break;

      const parsedBody = parseResponseText(await response.text());

      if (response.status === 429) {
        const waitMs = Math.max(1000, Number(parsedBody?.retry_after ?? 1) * 1000);
        this.bumpThrottle(waitMs);
        this.log('warn', `Server lookup was rate limited. Waiting ${waitMs}ms before retrying.`);
        await this.coolDown(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Unable to load the server list: ${response.status} ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`
        );
      }

      const page = Array.isArray(parsedBody) ? parsedBody : [];
      if (page.length === 0) break;
      guilds.push(...page);

      if (page.length < 200) break;
      after = safeTrim(page[page.length - 1]?.id);
      if (!after) break;
      await this.coolDown(250);
    }

    const targets = guilds.map((guild) => ({
      key: `guild:${guild.id}`,
      guildId: guild.id,
      channelId: '',
      label: formatGuildLabel(guild),
    }));

    if (targets.length === 0) {
      throw new Error('No searchable servers were found for this account.');
    }

    return targets;
  }

  async loadPrivateChannelTargets() {
    this.currentAction = 'Loading DM list';
    this.log('info', 'Loading DM conversations for this account.');

    while (!this.stopRequested) {
      const response = await this.withAbort((signal) =>
        this.client.getPrivateChannels(signal)
      ).catch((error) => {
        if (this.stopRequested) return null;
        throw error;
      });

      if (!response || this.stopRequested) break;

      const parsedBody = parseResponseText(await response.text());

      if (response.status === 429) {
        const waitMs = Math.max(1000, Number(parsedBody?.retry_after ?? 1) * 1000);
        this.bumpThrottle(waitMs);
        this.log('warn', `DM lookup was rate limited. Waiting ${waitMs}ms before retrying.`);
        await this.coolDown(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Unable to load DM conversations: ${response.status} ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`
        );
      }

      const channels = Array.isArray(parsedBody) ? parsedBody : [];
      const targets = channels
        .filter((channel) => channel?.type === 1 || channel?.type === 3)
        .map((channel) => ({
          key: `dm:${channel.id}`,
          guildId: '@me',
          channelId: channel.id,
          label: formatPrivateChannelLabel(channel),
        }));

      if (targets.length === 0) {
        throw new Error('No searchable DM conversations were found for this account.');
      }

      return targets;
    }

    return [];
  }

  updateTargetEstimate(target, totalResults) {
    this.targetEstimates.set(target.key, Math.max(0, totalResults));
    this.progress.totalEstimate = Array.from(this.targetEstimates.values())
      .reduce((sum, value) => sum + value, 0);
  }

  async runBulkTarget(target) {
    let offset = 0;

    while (!this.stopRequested) {
      this.progress.iterations += 1;
      this.currentAction = `Searching ${target.label}`;

      const response = await this.withAbort((signal) =>
        this.client.searchMessages(
          {
            ...this.payload,
            guildId: target.guildId,
            channelId: target.channelId,
            offset,
          },
          signal
        )
      ).catch((error) => {
        if (this.stopRequested) return null;
        throw error;
      });

      if (!response || this.stopRequested) break;

      if (response.status === 202) {
        const body = parseResponseText(await response.text());
        const waitMs = Math.max(1000, Number(body?.retry_after ?? 1) * 1000);
        this.bumpThrottle(waitMs);
        this.log('warn', `Discord is still indexing ${target.label}. Waiting ${waitMs}ms before retrying.`);
        await this.coolDown(waitMs);
        continue;
      }

      if (response.status === 429) {
        const body = parseResponseText(await response.text());
        const waitMs = Math.max(this.payload.searchDelay, Number(body?.retry_after ?? 1) * 1000);
        this.bumpThrottle(waitMs);
        this.payload.searchDelay = waitMs;
        this.log('warn', `Search rate limited for ${target.label}. Search delay raised to ${waitMs}ms.`);
        await this.coolDown(waitMs * 2);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Search failed for ${target.label}: ${response.status} ${body}`);
      }

      const data = await response.json();
      const discoveredMessages = pickHitMessages(data);
      this.updateTargetEstimate(target, Number(data.total_results ?? 0));

      if (discoveredMessages.length === 0) {
        this.log('info', `Reached the end of ${target.label}.`);
        this.currentAction = '';
        break;
      }

      const filtered = filterCandidateMessages(discoveredMessages, this.payload);
      this.progress.scanned += discoveredMessages.length;
      this.progress.matched += filtered.messagesToDelete.length;
      this.progress.skipped += filtered.skippedMessages.length;

      if (this.payload.previewOnly) {
        this.log(
          'debug',
          `Preview page in ${target.label}: ${filtered.messagesToDelete.length} matches, ${filtered.skippedMessages.length} skipped.`
        );
        offset += discoveredMessages.length;
        await this.coolDown(this.payload.searchDelay);
        continue;
      }

      if (filtered.messagesToDelete.length > 0) {
        for (const message of filtered.messagesToDelete) {
          if (this.stopRequested) break;
          await this.deleteWithRetry(message);
        }
      } else if (filtered.skippedMessages.length > 0) {
        offset += filtered.skippedMessages.length;
        this.log(
          'debug',
          `Skipped ${filtered.skippedMessages.length} non-target or non-deletable messages in ${target.label}.`
        );
      } else {
        this.log('info', `No more deletable messages found in ${target.label}.`);
        break;
      }

      await this.coolDown(this.payload.searchDelay);
    }
  }

  async runDirect() {
    this.progress.queueSize = this.payload.targets.length;
    this.progress.totalEstimate = this.payload.targets.length;
    if (this.payload.parseErrors.length > 0) {
      this.log(
        'warn',
        `Ignored ${this.payload.parseErrors.length} invalid line(s) while parsing direct targets.`,
        this.payload.parseErrors
      );
    }

    this.log('info', `Deleting ${this.payload.targets.length} specific message target(s).`);
    if (this.payload.note) {
      this.log('debug', `Run note: ${this.payload.note}`);
    }

    for (let index = 0; index < this.payload.targets.length; index++) {
      if (this.stopRequested) break;

      const target = this.payload.targets[index];
      this.progress.queueIndex = index + 1;
      this.currentTarget = target.guildId
        ? `${target.guildId}/${target.channelId}/${target.messageId}`
        : `${target.channelId}/${target.messageId}`;
      this.currentAction = `Deleting message ${target.messageId}`;
      await this.deleteWithRetry({
        id: target.messageId,
        channel_id: target.channelId,
        content: target.source,
        author: null,
        attachments: [],
      });
    }
  }

  async deleteWithRetry(message) {
    let attempt = 0;

    while (!this.stopRequested) {
      this.currentAction = `Deleting ${message.id}`;
      const response = await this.withAbort((signal) =>
        this.client.deleteMessage(message.channel_id, message.id, signal)
      ).catch((error) => {
        if (this.stopRequested) return null;
        throw error;
      });

      if (!response || this.stopRequested) return;

      if (response.ok) {
        this.progress.deleted += 1;
        this.log('success', `Deleted ${message.id} from ${message.channel_id}.`, {
          summary: describeMessage(message),
        });
        await this.coolDown(this.payload.deleteDelay);
        return;
      }

      if (response.status === 429) {
        const body = parseResponseText(await response.text());
        const waitMs = Math.max(this.payload.deleteDelay, Number(body?.retry_after ?? 1) * 1000);
        this.bumpThrottle(waitMs);
        this.payload.deleteDelay = waitMs;
        this.log('warn', `Delete rate limited. Delete delay raised to ${waitMs}ms.`);
        await this.coolDown(waitMs * 2);
        continue;
      }

      const parsedBody = parseResponseText(await response.text());

      if (response.status === 404) {
        this.progress.skipped += 1;
        this.log('warn', `Message ${message.id} was already gone.`);
        return;
      }

      if (response.status === 400 && parsedBody?.code === 50083) {
        this.progress.failed += 1;
        this.progress.skipped += 1;
        this.log('warn', `Message ${message.id} is inside an archived thread and cannot be deleted right now.`);
        return;
      }

      attempt += 1;
      if (attempt >= this.payload.maxAttempt) {
        this.progress.failed += 1;
        this.log(
          'error',
          `Failed to delete ${message.id} after ${attempt} attempt(s).`,
          {
            status: response.status,
            body: parsedBody,
          }
        );
        await this.coolDown(this.payload.deleteDelay);
        return;
      }

      this.log(
        'warn',
        `Delete failed for ${message.id}. Retrying (${attempt}/${this.payload.maxAttempt}).`,
        {
          status: response.status,
          body: parsedBody,
        }
      );
      await this.coolDown(this.payload.deleteDelay);
    }
  }
}

export class JobManager {
  constructor() {
    this.jobs = new Map();
  }

  createBulkJob(payload) {
    const job = new DeletionJob('bulk', payload).start();
    this.jobs.set(job.id, job);
    return job;
  }

  createDirectJob(payload) {
    const job = new DeletionJob('direct', payload).start();
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) ?? null;
  }

  listJobs() {
    return Array.from(this.jobs.values())
      .map((job) => job.snapshot())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  stopJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) return null;
    job.stop();
    return job;
  }
}
