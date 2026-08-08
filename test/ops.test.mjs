import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('service manifest defines an isolated loopback deployment', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, '.pranavg/release-manifest.json'), 'utf8'));
  assert.equal(manifest.origin, 'http://127.0.0.1:3015');
  assert.equal(manifest.candidateOrigin, 'http://127.0.0.1:3115');
  assert.equal(manifest.hostname, 'discordify.pranavg.dev');
  assert.equal(manifest.access, 'cloudflare-account-members-only');
});

test('LaunchAgent is valid, loopback-scoped, and carries no secret', () => {
  const plist = path.join(root, 'ops/dev.pranavg.discordify.plist');
  execFileSync('plutil', ['-lint', plist]);
  const source = readFileSync(plist, 'utf8');
  assert.match(source, /<string>3015<\/string>/);
  assert.match(source, /--allow-fs-read=\/Users\/pranav\/\.local\/share\/discordify/);
  assert.doesNotMatch(source, /token|password|credential/i);
});

test('deployment scripts pass zsh syntax validation and preserve guarded branches', () => {
  for (const script of ['ops/deploy-local.zsh', 'ops/push-live.zsh']) {
    execFileSync('zsh', ['-n', path.join(root, script)]);
  }
  const publisher = readFileSync(path.join(root, 'ops/push-live.zsh'), 'utf8');
  assert.match(publisher, /origin\/codex-dev/);
  assert.match(publisher, /\$\{requested_revision\}:refs\/heads\/production/);
  assert.doesNotMatch(publisher, /force|--force/);
});
