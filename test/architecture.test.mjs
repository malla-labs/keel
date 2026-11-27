import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decision, keel, project, read, write } from './helpers.mjs';

async function layered() {
  const dir = await project();
  await decision(dir, ['--title', 'The code is split into db, auth and calls', '--decision', 'auth and calls use db; calls uses auth; nothing uses calls.']);
  const add = (args) => keel(dir, ['module', 'add', ...args, '--decision', 'P-001']);
  assert.equal((await add(['db', '--about', 'Storage', '--files', 'src/db/**'])).code, 0);
  assert.equal((await add(['auth', '--about', 'Sign-in and sessions', '--files', 'src/auth/**', '--uses', 'db'])).code, 0);
  assert.equal((await add(['calls', '--about', 'Call signaling', '--files', 'src/calls/**', '--uses', 'auth,db'])).code, 0);
  write(dir, 'src/db/index.ts', 'export const db = 1;\n');
  write(dir, 'src/auth/session.ts', "import { db } from '../db/index.ts';\nimport fs from 'node:fs';\nexport const s = db;\n");
  write(dir, 'src/calls/hub.ts', "import { s } from '../auth/session';\nexport const h = s;\n");
  return dir;
}

test('a module needs a decision, its files and a purpose, and may only use modules that exist', async () => {
  const dir = await project();
  assert.match((await keel(dir, ['module', 'add', 'db', '--about', 'Storage', '--files', 'src/db/**'])).err, /--decision is required/);
  assert.match((await keel(dir, ['module', 'add', 'db', '--about', 'Storage', '--files', 'src/db/**', '--decision', 'P-001'])).err, /Decision P-001 does not exist/);
  await decision(dir);
  assert.match((await keel(dir, ['module', 'add', 'auth', '--about', 'Sign-in', '--files', 'src/auth/**', '--uses', 'db', '--decision', 'P-001'])).err, /"db", which is not a module/);
  assert.equal((await keel(dir, ['module', 'add', 'db', '--about', 'Storage', '--files', 'src/db/**', '--decision', 'P-001'])).code, 0);
  const doc = read(dir, 'docs/ARCHITECTURE.md');
  assert.match(doc, /\| db \| Storage \| `src\/db\/\*\*` \| — \| P-001 \|/);
});

test('an import across a boundary the architecture does not allow fails check', async () => {
  const dir = await layered();
  assert.equal((await keel(dir, ['check'])).code, 0, (await keel(dir, ['check'])).out);
  write(dir, 'src/auth/leak.ts', "import { h } from '../calls/hub';\nexport const x = h;\n");
  const r = await keel(dir, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/auth\/leak\.ts:1: module auth imports src\/calls\/hub\.ts \(module calls\), which auth may not use \(P-001\)/);
});

test('allowing the use through `module set` with a decision makes the import pass', async () => {
  const dir = await layered();
  write(dir, 'src/db/migrate.ts', "import { s } from '../auth/session.ts';\nexport const m = s;\n");
  assert.equal((await keel(dir, ['check'])).code, 1);
  await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Migrations may read sessions', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'db may use auth for migrations.']);
  assert.equal((await keel(dir, ['module', 'set', 'db', '--uses', 'auth', '--decision', 'P-002'])).code, 0);
  assert.equal((await keel(dir, ['check'])).code, 0);
  assert.match(read(dir, 'docs/ARCHITECTURE.md'), /\| db \| Storage \| `src\/db\/\*\*` \| auth \| P-001, P-002 \|/);
});

test('with modules defined, code outside every module is a warning and the brief names the modules', async () => {
  const dir = await layered();
  write(dir, 'src/util/strings.ts', 'export const a = 1;\n');
  assert.match((await keel(dir, ['check'])).out, /WARN {2}src\/util\/strings\.ts: belongs to no module/);
  assert.match((await keel(dir, ['brief'])).out, /Architecture: 3 modules \(auth, calls, db\)/);
  const bare = await project();
  assert.match((await keel(bare, ['brief'])).out, /Architecture: no modules defined/);
});

test('architecture.json is CLI-only and ARCHITECTURE.md must match it', async () => {
  const dir = await layered();
  const input = JSON.stringify({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.keel/architecture.json') } });
  assert.equal((await keel(dir, ['hook', 'guard'], input)).code, 2);
  write(dir, 'docs/ARCHITECTURE.md', '# Architecture\n\n<!-- keel:architecture -->\nhand edit\n<!-- /keel:architecture -->\n');
  assert.match((await keel(dir, ['check'])).out, /ARCHITECTURE\.md: is out of date/);
  await keel(dir, ['render']);
  assert.equal((await keel(dir, ['check'])).code, 0);
});
