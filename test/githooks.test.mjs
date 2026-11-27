import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { keel, project, read, write } from './helpers.mjs';

const KEEL = path.resolve('bin/keel');
const env = { ...process.env, PATH: `${path.dirname(KEEL)}:${process.env.PATH}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });

async function repo() {
  const dir = await project();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('install keeps an existing hook and runs keel before its exit; uninstall restores it', async () => {
  const dir = await repo();
  write(dir, '.git/hooks/pre-commit', '#!/bin/sh\necho mine\nexit 0\n');
  await keel(dir, ['githooks', 'install']);
  const text = read(dir, '.git/hooks/pre-commit');
  assert.ok(text.indexOf('keel:begin') < text.indexOf('echo mine'));
  await keel(dir, ['githooks', 'install']);
  assert.equal((read(dir, '.git/hooks/pre-commit').match(/keel:begin/g) || []).length, 1);
  assert.deepEqual(JSON.parse((await keel(dir, ['githooks', 'status'])).out), { 'pre-commit': 'installed', 'commit-msg': 'installed', 'pre-push': 'installed', 'post-merge': 'installed', 'merge-driver': 'installed' });
  await keel(dir, ['githooks', 'uninstall']);
  assert.equal(read(dir, '.git/hooks/pre-commit'), '#!/bin/sh\necho mine\nexit 0\n');
  assert.equal(fs.existsSync(path.join(dir, '.git/hooks/commit-msg')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitattributes')), false);
  assert.equal(JSON.parse((await keel(dir, ['githooks', 'status'])).out)['merge-driver'], 'missing');
});

test('pre-commit blocks a commit whose changed files fail check, and allows a clean one', async () => {
  const dir = await repo();
  await keel(dir, ['githooks', 'install']);
  write(dir, 'a.test.ts', "test('x', () => {});\n");
  git(dir, 'add', '-A');
  const bad = git(dir, 'commit', '-qm', 'bad');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /keel pre-commit: blocked[\s\S]*a\.test\.ts:1: test cites nothing/);
  write(dir, 'a.test.ts', "// Covers: P-001\ntest('x', () => {});\n");
  await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Bookings are stored in Postgres', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'x']);
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-qm', 'good').status, 0);
});

test('commit-msg adds the active feature as a trailer, once', async () => {
  const dir = await repo();
  await keel(dir, ['githooks', 'install']);
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel', '--files', 'src/**']);
  await keel(dir, ['scope', 'start', 'booking.cancel']);
  write(dir, 'src/a.ts', 'export const a = 1;\n');
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-qm', 'Add cancel\n\nCo-Authored-By: X <x@x>').status, 0);
  assert.equal(git(dir, 'log', '-1', '--format=%B').stdout.trim(), 'Add cancel\n\nCo-Authored-By: X <x@x>\nFeature: booking.cancel');
});

test('observe mode prints but lets the commit through', async () => {
  const dir = await repo();
  const f = path.join(dir, '.keel/project.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), gate: 'observe' }));
  await keel(dir, ['githooks', 'install']);
  write(dir, 'a.test.ts', "test('x', () => {});\n");
  git(dir, 'add', '-A');
  const r = git(dir, 'commit', '-qm', 'x');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /would block \(observe\)/);
});

test('pre-push runs verify.quick and blocks when it fails', async () => {
  const dir = await repo();
  const f = path.join(dir, '.keel/project.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), verify: { quick: 'exit 3' } }));
  await keel(dir, ['githooks', 'install']);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'cfg');
  const remote = fs.mkdtempSync(path.join(path.dirname(dir), 'remote-'));
  execFileSync('git', ['init', '-q', '--bare'], { cwd: remote });
  git(dir, 'remote', 'add', 'origin', remote);
  const r = git(dir, 'push', '-q', 'origin', 'HEAD:main');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /verify\.quick failed \(exit 3\)/);
});
