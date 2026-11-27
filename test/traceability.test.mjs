import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decision, keel, productQuestion, project, write } from './helpers.mjs';

async function verifiedFeature(dir, id, folder) {
  await keel(dir, ['feature', 'add', id, '--title', `Feature ${id}`, '--status', 'building', '--files', `src/${folder}/**`]);
  await keel(dir, ['feature', 'check', id, '--add', 'It does the one thing it promises']);
  write(dir, `src/${folder}/a.test.ts`, `// Covers: ${id}#1\ntest('one', () => {});\n`);
  write(dir, `src/${folder}/a.ts`, 'export const a = 1;\n');
  const r = await keel(dir, ['feature', 'verified', id, '--command', 'npm test']);
  if (r.code !== 0) throw new Error(r.err);
}

test('every id in a "Decision: A, B" list is checked and counts as cited', async () => {
  const dir = await project();
  await decision(dir);
  write(dir, 'src/a.ts', '// Decision: P-001, P-404\nexport const x = 1;\n');
  assert.match((await keel(dir, ['check'])).out, /src\/a\.ts:1: cites P-404, which does not exist/);
  write(dir, 'src/a.ts', 'export const x = 1;\n');

  await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Bookings are cached in Redis', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'Cache in Redis.']);
  await verifiedFeature(dir, 'booking.list', 'bookings');
  await keel(dir, ['feature', 'set', 'booking.list', '--decision', 'P-001,P-002']);
  write(dir, 'src/bookings/a.ts', '// Decision: P-001, P-002\nexport const a = 1;\n');
  await keel(dir, ['feature', 'verified', 'booking.list', '--command', 'npm test']);
  const r = await keel(dir, ['feature', 'set', 'booking.list', '--status', 'built']);
  assert.equal(r.code, 0, r.err);
});

test('code naming a question warns once it is answered, and fails when the question never existed', async () => {
  const dir = await project();
  await keel(dir, productQuestion);
  write(dir, 'src/refund.ts', '// Default until Q-1 is answered.\nexport const refund = 0.5;\n');
  let r = await keel(dir, ['check']);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /Q-1/);

  await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'owner', '--status', 'accepted', '--decision', '50%.', '--quote', '50% refund']);
  await keel(dir, ['question', 'answer', '1', '--answer', 'A', '--by', 'owner', '--decision', 'D-001']);
  r = await keel(dir, ['check']);
  assert.match(r.out, /src\/refund\.ts:1: names Q-1, which is no longer open; cite D-001 instead/);
  assert.equal((await keel(dir, ['check', '--strict'])).code, 1);

  write(dir, 'src/refund.ts', '// See Q-9.\n');
  assert.match((await keel(dir, ['check'])).out, /names Q-9, which does not exist/);
});

test('verified --stale verifies again only the features whose files changed', async () => {
  const dir = await project();
  await verifiedFeature(dir, 'booking.cancel', 'bookings');
  await verifiedFeature(dir, 'payment.refund', 'payments');
  write(dir, 'src/payments/a.ts', 'export const a = 2;\n');
  const r = await keel(dir, ['feature', 'verified', '--stale', '--command', 'npm test']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).verified, ['payment.refund']);
  const p = JSON.parse((await keel(dir, ['progress', '--json'])).out);
  assert.deepEqual(p.features.map((f) => f.verified), ['yes', 'yes']);
});

test('a verification keeps the evidence given with it', async () => {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'web.client', '--title', 'Browser client', '--files', 'public/**']);
  await keel(dir, ['feature', 'check', 'web.client', '--add', 'Two browsers hold a call']);
  write(dir, 'public/app.test.js', "// Covers: web.client#1\ntest('call', () => {});\n");
  const r = await keel(dir, ['feature', 'verified', 'web.client', '--command', 'npm test', '--evidence', 'screenshot: shots/call.png', '--evidence', 'two Chrome contexts held a call']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).verified.evidence, ['screenshot: shots/call.png', 'two Chrome contexts held a call']);
});

test('an open important review finding blocks "built" until it is resolved; rejected ones do not', async () => {
  const dir = await project();
  await verifiedFeature(dir, 'auth.email', 'auth');
  const add = (extra) => keel(dir, ['review', 'add', '--feature', 'auth.email', '--where', 'src/auth/a.ts:1', ...extra]);
  assert.match((await add(['--severity', 'important', '--verdict', 'rejected', '--summary', 'Codes are not hashed'])).err, /--reason is required/);
  assert.equal((await add(['--severity', 'important', '--verdict', 'rejected', '--summary', 'Codes are not hashed', '--reason', 'They are hashed at line 9'])).code, 0);
  const r = await add(['--severity', 'important', '--verdict', 'confirmed', '--summary', 'A new code resets the wrong-try count']);
  assert.equal(JSON.parse(r.out).id, 'R-2');

  assert.match((await keel(dir, ['progress', 'auth.email'])).out, /open findings R-2/);
  assert.match((await keel(dir, ['feature', 'set', 'auth.email', '--status', 'built'])).err, /open review finding R-2/);
  assert.match((await keel(dir, ['review', 'resolve', 'R-2'])).err, /exactly one of --fixed/);
  assert.equal((await keel(dir, ['review', 'resolve', 'R-2', '--fixed', 'Limit 5 requests per hour'])).code, 0);
  assert.equal((await keel(dir, ['feature', 'set', 'auth.email', '--status', 'built'])).code, 0);
  assert.match((await keel(dir, ['review', 'list'])).out, /R-2 fixed .*→ fixed: Limit 5 requests per hour/);
});

test('review findings are written by the CLI only: the guard blocks hand edits', async () => {
  const dir = await project();
  const path = await import('node:path');
  const input = JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.keel/reviews.json') } });
  const r = await keel(dir, ['hook', 'guard'], input);
  assert.equal(r.code, 2);
  assert.match(r.err, /written by the keel CLI only/);
});
