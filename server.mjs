import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DiscordClient } from './lib/discord-client.mjs';
import { JobManager } from './lib/job-manager.mjs';
import { safeTrim } from './lib/helpers.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '4782', 10);
const HOST = '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const jobs = new JobManager();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    'Content-Type': contentType,
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

async function serveStatic(response, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const normalizedPath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': content.length,
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    });
    response.end(content);
  } catch {
    sendText(response, 404, 'Not Found');
  }
}

async function handleAccountLookup(response, body) {
  const token = safeTrim(body.token);
  if (!token) {
    sendJson(response, 400, { error: 'Missing token.' });
    return;
  }

  const client = new DiscordClient(token);
  const lookupResponse = await client.getCurrentUser();
  const text = await lookupResponse.text();

  if (!lookupResponse.ok) {
    sendJson(response, lookupResponse.status, {
      error: 'Unable to validate token.',
      details: text,
    });
    return;
  }

  const user = JSON.parse(text);
  sendJson(response, 200, {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.global_name,
      discriminator: user.discriminator,
      avatar: user.avatar,
    },
  });
}

async function handleGuildLookup(response, body) {
  const token = safeTrim(body.token);
  const guildId = safeTrim(body.guildId);

  if (!token || !guildId || guildId === '@me') {
    sendJson(response, 400, { error: 'Provide a token and a guild ID.' });
    return;
  }

  const client = new DiscordClient(token);
  const guildResponse = await client.getGuildChannels(guildId);
  const text = await guildResponse.text();

  if (!guildResponse.ok) {
    sendJson(response, guildResponse.status, {
      error: 'Unable to fetch guild channels.',
      details: text,
    });
    return;
  }

  const channels = JSON.parse(text)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parentId: channel.parent_id,
      position: channel.position,
      type: channel.type,
      topic: channel.topic,
      nsfw: Boolean(channel.nsfw),
    }))
    .sort((left, right) => {
      const parentDelta = String(left.parentId ?? '').localeCompare(String(right.parentId ?? ''));
      if (parentDelta !== 0) return parentDelta;
      return (left.position ?? 0) - (right.position ?? 0);
    });

  sendJson(response, 200, { channels });
}

async function routeApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/jobs') {
    sendJson(response, 200, { jobs: jobs.listJobs() });
    return;
  }

  if (request.method === 'GET' && pathname.startsWith('/api/jobs/')) {
    const jobId = pathname.split('/').pop();
    const job = jobs.getJob(jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Job not found.' });
      return;
    }

    sendJson(response, 200, { job: job.snapshot() });
    return;
  }

  const body = await readJsonBody(request);

  if (request.method === 'POST' && pathname === '/api/account/lookup') {
    await handleAccountLookup(response, body);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/guilds/channels') {
    await handleGuildLookup(response, body);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/jobs/bulk') {
    try {
      const job = jobs.createBulkJob(body);
      sendJson(response, 201, { job: job.snapshot() });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Unable to create bulk job.',
      });
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/jobs/direct') {
    try {
      const job = jobs.createDirectJob(body);
      sendJson(response, 201, { job: job.snapshot() });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Unable to create direct delete job.',
      });
    }
    return;
  }

  if (request.method === 'POST' && pathname.endsWith('/stop') && pathname.startsWith('/api/jobs/')) {
    const jobId = pathname.split('/')[3];
    const job = jobs.stopJob(jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Job not found.' });
      return;
    }

    sendJson(response, 200, { job: job.snapshot() });
    return;
  }

  sendJson(response, 404, { error: 'Unknown API route.' });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith('/api/')) {
      await routeApi(request, response, url.pathname);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`discordify is running at http://${HOST}:${PORT}`);
});
