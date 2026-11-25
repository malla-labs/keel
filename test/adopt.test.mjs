import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keel, project, read, write } from './helpers.mjs';

test('scan reports languages, test scripts, layout and docs', async () => {
  const dir = await project();
  write(dir, 'package.json', JSON.stringify({ scripts: { test: 'vitest', dev: 'vite', format: 'x' } }));
  write(dir, 'apps/api/src/a.ts', '');
  write(dir, 'apps/api/src/a.test.ts', '');
  write(dir, 'docs/adr/0001-x.md', '# x');
  const s = JSON.parse((await keel(dir, ['scan'])).out);
  assert.equal(s.languages.TypeScript, 2);
  assert.deepEqual(s.scripts['package.json'], { test: 'vitest', dev: 'vite' });
  assert.equal(s.tests.files, 1);
  assert.ok(s.layout['apps/api/src']);
  assert.ok(s.decisionFolders.includes('docs/adr'));
});

test('the summary is stored in the state file and opens every brief', async () => {
  const dir = await project();
  assert.match((await keel(dir, ['summary', 'set', '--text', 'short'])).err, /too short/);
  const text = 'Rentals: a car-rental marketplace for renters and hosts.\nStack: Hono API, Nuxt web, Postgres.';
  assert.equal((await keel(dir, ['summary', 'set', '--text', text])).code, 0);
  assert.match(read(dir, 'docs/STATE.md'), /<!-- keel:summary -->\nRentals: a car-rental/);
  assert.match((await keel(dir, ['brief'])).out, /The project:\nRentals: a car-rental marketplace/);
  await keel(dir, ['summary', 'set', '--text', text.replace('Postgres', 'Postgres and Redis')]);
  assert.equal((read(dir, 'docs/STATE.md').match(/<!-- keel:summary -->/g) || []).length, 1);
});

test('an existing test can cover a check without being edited, and a vanished one is an error', async () => {
  const dir = await project();
  write(dir, 'src/cancel.test.ts', "// Covers: x\ntest('refunds early', () => {});\n");
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel', '--status', 'built']);
  assert.match((await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Early cancel refunds all', '--test', 'src/cancel.test.ts::nope'])).err, /has no test named "nope"/);
  assert.equal((await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Early cancel refunds all', '--test', 'src/cancel.test.ts::refunds early'])).code, 0);
  assert.deepEqual(JSON.parse((await keel(dir, ['progress', '--json'])).out).checks, { total: 1, covered: 1 });
  write(dir, 'src/cancel.test.ts', "// Covers: x\ntest('renamed', () => {});\n");
  assert.match((await keel(dir, ['check'])).out, /booking\.cancel#1: linked test is gone/);
});
