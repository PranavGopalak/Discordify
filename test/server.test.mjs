import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const TEST_PORT = 4873;
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let serverProcess;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : '';
    const request = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: pathname,
      method: options.method ?? 'GET',
      headers: {
        Host: options.host ?? `127.0.0.1:${TEST_PORT}`,
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

before(async () => {
  serverProcess = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DISCORDIFY_REVISION: 'test-revision',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start.')), 5000);
    serverProcess.once('error', reject);
    serverProcess.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(`127.0.0.1:${TEST_PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.stderr.on('data', (chunk) => {
      clearTimeout(timeout);
      reject(new Error(chunk.toString()));
    });
  });
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill('SIGTERM');
  await new Promise((resolve) => serverProcess.once('exit', resolve));
});

test('local health and version endpoints expose only the required diagnostics', async () => {
  const health = await request('/__health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });
  assert.match(health.headers['content-security-policy'], /default-src 'self'/);

  const version = await request('/__version');
  assert.equal(version.status, 200);
  assert.deepEqual(JSON.parse(version.body), { revision: 'test-revision' });
});

test('the public hostname does not reveal the deployed revision', async () => {
  const response = await request('/__version', { host: 'discordify.pranavg.dev' });
  assert.equal(response.status, 404);
});

test('unknown hosts and cross-origin writes are rejected before routing', async () => {
  const unknownHost = await request('/', { host: 'example.com' });
  assert.equal(unknownHost.status, 421);

  const missingOrigin = await request('/api/jobs/bulk', {
    method: 'POST',
    body: {},
  });
  assert.equal(missingOrigin.status, 403);

  const sameOrigin = await request('/api/jobs/bulk', {
    method: 'POST',
    origin: `http://127.0.0.1:${TEST_PORT}`,
    body: {},
  });
  assert.equal(sameOrigin.status, 400);
  assert.match(JSON.parse(sameOrigin.body).error, /token is required/i);
});
