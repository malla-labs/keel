import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keel, project, read, write } from './helpers.mjs';

async function feature() {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--status', 'building', '--files', 'src/bookings/**']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Early cancel refunds everything']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Late cancel refunds half']);
  return dir;
}

test('progress counts checks that have a test', async () => {
  const dir = await feature();
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n");
  const p = JSON.parse((await keel(dir, ['progress', '--json'])).out);
  assert.deepEqual(p.checks, { total: 2, covered: 1 });
  assert.equal(p.features[0].percent, 40);
  assert.deepEqual(p.features[0].uncovered, ['#2 Late cancel refunds half']);
  assert.match((await keel(dir, ['progress', 'booking.cancel'])).out, /no test: #2 Late cancel refunds half/);
});

test('a feature is verified only with a test per check and a clean check, and goes stale on change', async () => {
  const dir = await feature();
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n");
  assert.match((await keel(dir, ['feature', 'verified', 'booking.cancel', '--command', 'npm test'])).err, /checks without a test: #2/);
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n// Covers: booking.cancel#2\ntest('late', () => {});\n");
  assert.match((await keel(dir, ['feature', 'verified', 'booking.cancel'])).err, /--command is required/);
  assert.equal((await keel(dir, ['feature', 'verified', 'booking.cancel', '--command', 'npm test'])).code, 0);
  await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'built']);
  let f = JSON.parse((await keel(dir, ['progress', '--json'])).out).features[0];
  assert.equal(f.verified, 'yes');
  assert.equal(f.percent, 100);
  write(dir, 'src/bookings/cancel.ts', 'export const changed = 1;\n');
  f = JSON.parse((await keel(dir, ['progress', '--json'])).out).features[0];
  assert.equal(f.verified, 'stale');
  assert.equal(f.percent, 90);
});

test('every change is logged and counted per week; the log is CLI-only', async () => {
  const dir = await feature();
  await keel(dir, ['scope', 'start', 'booking.cancel']);
  await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'mocked']);
  const types = read(dir, '.keel/history.jsonl').trim().split('\n').map((l) => JSON.parse(l).type);
  assert.deepEqual(types, ['feature.add', 'feature.check', 'feature.check', 'scope.start', 'feature.status']);
  const p = JSON.parse((await keel(dir, ['progress', '--json'])).out);
  assert.deepEqual(p.weekly, [{ week: '2026-W48', built: 0, checks: 2, decisions: 0, answered: 0 }]);
  assert.equal(p.scope.feature, 'booking.cancel');
  const path = await import('node:path');
  const ev = JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.keel/history.jsonl') } });
  assert.equal((await keel(dir, ['hook', 'guard'], ev)).code, 2);
});

test('check keeps the progress in the state file current', async () => {
  const dir = await feature();
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n");
  assert.equal((await keel(dir, ['check'])).code, 0);
  assert.match(read(dir, 'docs/STATE.md'), /\| `booking.cancel` Cancel a booking \| building \| ████░░░░░░ 40% \| 1\/2 \|/);
});

test('the weekly pace counts only what happened after adoption', async () => {
  const dir = await feature();
  await keel(dir, ['adopted']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'A host cancel refunds everything']);
  const p = JSON.parse((await keel(dir, ['progress', '--json'])).out);
  assert.deepEqual(p.weekly, [{ week: '2026-W48', built: 0, checks: 1, decisions: 0, answered: 0 }]);
});

test('built is refused until every check is tested, verified and the code cites its decisions', async () => {
  const dir = await feature();
  await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Refunds are computed in cents', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'x']);
  await keel(dir, ['feature', 'set', 'booking.cancel', '--decision', 'P-001']);
  let r = await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'built']);
  assert.equal(r.code, 1);
  assert.match(r.err, /checks without a test: #1, #2[\s\S]*no verification recorded/);
  write(dir, 'src/bookings/cancel.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n// Covers: booking.cancel#2\ntest('late', () => {});\n");
  write(dir, 'src/bookings/cancel.ts', 'export const x = 1;\n');
  await keel(dir, ['feature', 'verified', 'booking.cancel', '--command', 'npm test']);
  r = await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'built']);
  assert.match(r.err, /decisions not cited in the feature's code: P-001/);
  write(dir, 'src/bookings/cancel.ts', '// Decision: P-001\nexport const x = 1;\n');
  assert.match((await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'built'])).err, /verification is stale/);
  await keel(dir, ['feature', 'verified', 'booking.cancel', '--command', 'npm test']);
  assert.equal((await keel(dir, ['feature', 'set', 'booking.cancel', '--status', 'built'])).code, 0);
});

test('adding files to a feature needs a reason and is logged', async () => {
  const dir = await feature();
  assert.match((await keel(dir, ['feature', 'set', 'booking.cancel', '--files', 'src/payments/**'])).err, /needs --reason/);
  assert.equal((await keel(dir, ['feature', 'set', 'booking.cancel', '--files', 'src/payments/**', '--reason', 'cancel owns the refund call'])).code, 0);
  const last = read(dir, '.keel/history.jsonl').trim().split('\n').map((l) => JSON.parse(l)).pop();
  assert.deepEqual([last.type, last.added, last.reason], ['feature.files', ['src/payments/**'], 'cancel owns the refund call']);
});
