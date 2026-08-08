import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DiscordClient } from './lib/discord-client.mjs';
import { JobManager } from './lib/job-manager.mjs';
import { safeTrim } from './lib/helpers.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '4782', 10);
const HOST = '127.0.0.1';
const REVISION = safeTrim(process.env.DISCORDIFY_REVISION) || 'development';
const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_HOST = 'discordify.pranavg.dev';
const ALLOWED_HOSTS = new Set([PUBLIC_HOST, `127.0.0.1:${PORT}`, `localhost:${PORT}`]);
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

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function responseHeaders(extra = {}) {
  return {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...responseHeaders(),
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    ...responseHeaders(),
    'Content-Length': Buffer.byteLength(text),
    'Content-Type': contentType,
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
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
      ...responseHeaders(),
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
  if (request.method === 'GET' && pathname === '/__health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && pathname === '/__version') {
    const requestHost = String(request.headers.host ?? '').toLowerCase();
    if (requestHost === PUBLIC_HOST) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    sendJson(response, 200, { revision: REVISION });
    return;
  }

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
    const requestHost = String(request.headers.host ?? '').toLowerCase();
    if (!ALLOWED_HOSTS.has(requestHost)) {
      sendText(response, 421, 'Misdirected Request');
      return;
    }

    const url = new URL(request.url, `http://${requestHost}`);

    if (request.method === 'POST') {
      const origin = safeTrim(request.headers.origin).toLowerCase();
      const expectedOrigin = requestHost === PUBLIC_HOST
        ? `https://${PUBLIC_HOST}`
        : `http://${requestHost}`;
      if (origin !== expectedOrigin) {
        sendJson(response, 403, { error: 'Request origin was rejected.' });
        return;
      }
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) {
      await routeApi(request, response, url.pathname);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error?.statusCode ?? 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`discordify is running at http://${HOST}:${PORT}`);
});
