import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keel, project, write } from './helpers.mjs';

const ok = (text) => `node -e "console.log('${text}')"`;
const bad = (text) => `node -e "console.log('${text}'); process.exit(3)"`;

/** Sets `verify` the way the owner would, by editing project.json. */
function setVerify(dir, verify) {
  const file = path.join(dir, '.keel/project.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.verify = { ...cfg.verify, ...verify };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

async function testedFeature(dir) {
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--status', 'building', '--files', 'src/bookings/**']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Early cancel refunds everything']);
  write(dir, 'src/bookings/a.test.ts', "// Covers: booking.cancel#1\ntest('early', () => {});\n");
}

test('keel verify runs the tests, lint and types, and stops at the first failure', async () => {
  const dir = await project();
  assert.match((await keel(dir, ['verify'])).err, /No verify\.quick command/);

  setVerify(dir, { quick: ok('24 passing'), lint: ok('0 problems'), types: ok('no type errors') });
  let r = await keel(dir, ['verify']);
  assert.equal(r.code, 0);
  assert.match(r.out, /PASS {2}quick: .*\n {6}24 passing\nPASS {2}lint: .*\n {6}0 problems\nPASS {2}types: /);

  setVerify(dir, { lint: bad('3 problems') });
  r = await keel(dir, ['verify']);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}lint: .*\n {6}3 problems/);
  assert.doesNotMatch(r.out, /types:/);
});

test('verified --run records what keel ran, and records nothing when a step fails', async () => {
  const dir = await project();
  await testedFeature(dir);
  setVerify(dir, { quick: ok('1 passing'), lint: bad('2 problems') });
  let r = await keel(dir, ['feature', 'verified', 'booking.cancel', '--run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /FAIL {2}lint/);
  assert.equal(JSON.parse((await keel(dir, ['progress', '--json'])).out).features[0].verified, 'no');

  setVerify(dir, { lint: ok('0 problems') });
  r = await keel(dir, ['feature', 'verified', 'booking.cancel', '--run']);
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out).verified;
  assert.equal(v.command, `${ok('1 passing')} && ${ok('0 problems')}`);
  assert.deepEqual(v.evidence, ['quick: 1 passing', 'lint: 0 problems']);
});

test('a feature carries a review risk: low, normal (default) or high', async () => {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'auth.email', '--title', 'Sign in by email', '--risk', 'high']);
  await keel(dir, ['feature', 'add', 'ui.theme', '--title', 'Dark theme']);
  const show = async (id) => JSON.parse((await keel(dir, ['feature', 'show', id])).out);
  assert.equal((await show('auth.email')).risk, 'high');
  assert.equal((await show('ui.theme')).risk, 'normal');
  assert.match((await keel(dir, ['feature', 'set', 'ui.theme', '--risk', 'tiny'])).err, /--risk must be one of low, normal, high/);
  await keel(dir, ['feature', 'set', 'ui.theme', '--risk', 'low']);
  assert.equal((await show('ui.theme')).risk, 'low');
});
