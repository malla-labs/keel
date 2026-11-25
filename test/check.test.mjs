import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decision, keel, project, write } from './helpers.mjs';

async function withFeature() {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--status', 'building', '--files', 'src/bookings/**']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Renter cancels early and gets everything back']);
  return dir;
}

test('a test that cites nothing fails check', async () => {
  const dir = await withFeature();
  write(dir, 'src/bookings/cancel.test.ts', "test('refunds', () => {});\n");
  const r = await keel(dir, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /cancel\.test\.ts:1: test cites nothing/);
});

test('a test citing an existing check passes; a missing check fails', async () => {
  const dir = await withFeature();
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('refunds early', () => {});\n");
  assert.equal((await keel(dir, ['check'])).code, 0);
  write(dir, 'src/bookings/cancel.test.ts', "test('refunds — Covers: booking.cancel#9', () => {});\n");
  assert.match((await keel(dir, ['check'])).out, /booking\.cancel has no check #9/);
});

test('an uncovered check and a doubly covered check are warnings', async () => {
  const dir = await withFeature();
  assert.match((await keel(dir, ['check'])).out, /WARN .*booking\.cancel#1: no test covers/);
  write(dir, 'src/a.test.ts', "// Covers: booking.cancel#1\nit('a', () => {});\n// Covers: booking.cancel#1\nit('b', () => {});\n");
  const r = await keel(dir, ['check']);
  assert.match(r.out, /2 tests cover this check/);
  assert.equal((await keel(dir, ['check', '--strict'])).code, 1);
});

test('code citing a missing or unaccepted product decision fails', async () => {
  const dir = await project();
  write(dir, 'src/a.ts', '// Decision: P-404\nexport const x = 1;\n');
  assert.match((await keel(dir, ['check'])).out, /src\/a\.ts:1: cites P-404, which does not exist/);
  await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'lead', '--decision', '50%.']);
  write(dir, 'src/a.ts', '// Decision: D-001\n');
  assert.match((await keel(dir, ['check'])).out, /a product rule the owner has not accepted/);
  await decision(dir);
  write(dir, 'src/a.ts', '// Decision: P-001\n');
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('a broken record header fails check', async () => {
  const dir = await project();
  write(dir, 'docs/decisions/platform/P-001-x.md', '# P-002: Wrong id\n\nStatus: maybe\n');
  const r = await keel(dir, ['check']);
  assert.match(r.out, /title id P-002 does not match file name id P-001/);
  assert.match(r.out, /status line "maybe"/);
  assert.match(r.out, /missing "Kind:" line/);
});

test('legacy records without a status line pass when configured', async () => {
  const dir = await project();
  const fs = await import('node:fs');
  const cfgFile = `${dir}/.keel/project.json`;
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.legacyBelow = { P: 10 };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  write(dir, 'docs/decisions/platform/P-003-old.md', '# P-003: An old rule\n\n## Context\n');
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('a baseline lets old errors pass while a new one still fails', async () => {
  const dir = await project();
  write(dir, 'src/old.test.ts', "test('old one', () => {});\n");
  assert.equal((await keel(dir, ['check'])).code, 1);
  assert.equal(JSON.parse((await keel(dir, ['baseline'])).out).baselined, 1);
  write(dir, 'src/old.test.ts', "// moved down\n\ntest('old one', () => {});\n");
  assert.match((await keel(dir, ['check'])).out, /OK: 0 errors, 0 warnings, 1 baselined/);
  write(dir, 'src/old.test.ts', "test('old one', () => {});\ntest('new one', () => {});\n");
  const r = await keel(dir, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /old\.test\.ts:2: test cites nothing/);
});
