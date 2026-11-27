import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { keel, productQuestion, project, read } from './helpers.mjs';

const KEEL = path.resolve('bin/keel');

/** Runs `fn` as the git user `email`, then restores the environment. */
async function as(email, fn) {
  const before = { name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL };
  process.env.GIT_AUTHOR_NAME = email.split('@')[0];
  process.env.GIT_AUTHOR_EMAIL = email;
  try { return await fn(); } finally {
    for (const [k, v] of [['GIT_AUTHOR_NAME', before.name], ['GIT_AUTHOR_EMAIL', before.email]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('on a team, only the owner\'s own git identity accepts product rules and answers product questions', async () => {
  const dir = await project(['--owner', 'Ana <ana@x.io>', '--session-owner']);
  const r = JSON.parse((await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'bob', '--decision', '50%.'])).out);
  await keel(dir, productQuestion);

  await as('bob@x.io', async () => {
    assert.match((await keel(dir, ['brief'])).out, /Owner: Ana\. The person in this session is not an owner \(their git identity matches no owner\)/);
    assert.match((await keel(dir, ['decision', 'accept', r.id, '--by', 'Ana', '--quote', 'yes'])).err, /Only Ana accepts a product rule, and this session's git identity is bob@x\.io, not ana@x\.io/);
    assert.match((await keel(dir, ['question', 'answer', '1', '--answer', 'A', '--by', 'Ana'])).err, /git identity is bob@x\.io/);
  });
  await as('ana@x.io', async () => {
    assert.match((await keel(dir, ['brief'])).out, /is the owner \(Ana, by git identity\)/);
    assert.equal((await keel(dir, ['decision', 'accept', r.id, '--by', 'Ana', '--quote', 'yes'])).code, 0);
    assert.equal((await keel(dir, ['question', 'answer', '1', '--answer', 'A', '--by', 'Ana'])).code, 0);
  });
});

test('two branches that both add a question and a check merge with no conflict; theirs are renumbered', async () => {
  const dir = await project();
  const env = { ...process.env, PATH: `${path.dirname(KEEL)}:${process.env.PATH}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking']);
  await keel(dir, ['githooks', 'install']);
  git('add', '-A');
  git('commit', '-qm', 'init');

  git('checkout', '-qb', 'other');
  await keel(dir, ['question', 'add', '--kind', 'engineering', '--question', 'Which queue carries refund jobs?', '--blocks', 'Refunds run in the background.', '--option', '*Postgres table', '--option', 'Redis', '--default', 'A table.']);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Late cancel refunds half']);
  git('add', '-A');
  git('commit', '-qm', 'other');

  git('checkout', '-q', 'main');
  await keel(dir, productQuestion);
  await keel(dir, ['feature', 'check', 'booking.cancel', '--add', 'Early cancel refunds everything']);
  git('add', '-A');
  git('commit', '-qm', 'main');

  const merge = git('merge', '-q', '--no-edit', 'other');
  assert.match(merge.stderr, /questions\.json: their #1 became #2/);
  const q = JSON.parse(read(dir, '.keel/questions.json'));
  assert.equal(q.lastId, 2);
  assert.deepEqual(q.open.map((x) => [x.id, x.kind]), [[1, 'product'], [2, 'engineering']]);
  const f = JSON.parse(read(dir, '.keel/features.json'))['booking.cancel'];
  assert.deepEqual(f.checks, { 1: 'Early cancel refunds everything', 2: 'Late cancel refunds half' });
  assert.match(read(dir, 'docs/decisions/OPEN_QUESTIONS.md'), /Q-2 · engineering/);
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('starting a scope records who holds the feature; others are refused unless they take it over', async () => {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--files', 'src/bookings/**']);
  await as('bob@x.io', async () => assert.equal((await keel(dir, ['scope', 'start', 'booking.cancel'])).code, 0));
  assert.match(JSON.stringify(JSON.parse((await keel(dir, ['feature', 'show', 'booking.cancel'])).out).holder), /bob <bob@x\.io>/);
  await as('ana@x.io', async () => {
    assert.match((await keel(dir, ['brief'])).out, /Held by others: booking\.cancel \(bob, since 2026-11-25\)/);
    assert.match((await keel(dir, ['scope', 'start', 'booking.cancel'])).err, /held by bob <bob@x\.io> since 2026-11-25/);
    assert.equal((await keel(dir, ['scope', 'start', 'booking.cancel', '--take'])).code, 0);
    await keel(dir, ['scope', 'clear']);
  });
  assert.equal(JSON.parse((await keel(dir, ['feature', 'show', 'booking.cancel'])).out).holder, undefined);
});

test('decision renumber gives a colliding record the next number and fixes the references named', async () => {
  const dir = await project();
  const { write } = await import('./helpers.mjs');
  await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Bookings are stored in Postgres', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'Postgres.']);
  write(dir, 'docs/decisions/platform/P-001-refunds-run-in-a-queue.md', '# P-001: Refunds run in a queue\n\nStatus: accepted (lead, 2026-11-25)\nKind: engineering\n\n## Decision\n\nA queue.\n');
  write(dir, 'src/refunds/queue.ts', '// Decision: P-001\nexport const q = 1;\n');
  write(dir, 'src/bookings/store.ts', '// Decision: P-001\nexport const s = 1;\n');
  assert.match((await keel(dir, ['check'])).out, /id P-001 is also used by/);
  const r = JSON.parse((await keel(dir, ['decision', 'renumber', 'docs/decisions/platform/P-001-refunds-run-in-a-queue.md', '--refs', 'src/refunds/**'])).out);
  assert.deepEqual([r.from, r.to, r.references], ['P-001', 'P-002', ['src/refunds/queue.ts']]);
  assert.match(read(dir, 'docs/decisions/platform/P-002-refunds-run-in-a-queue.md'), /^# P-002: Refunds run in a queue/);
  assert.match(read(dir, 'src/bookings/store.ts'), /Decision: P-001/);
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('ci github writes a pull-request workflow pinned to this keel version', async () => {
  const dir = await project();
  const r = JSON.parse((await keel(dir, ['ci', 'github'])).out);
  assert.equal(r.file, '.github/workflows/keel.yml');
  const wf = read(dir, '.github/workflows/keel.yml');
  assert.match(wf, /run: npx --yes github:malla-labs\/keel#v\d+\.\d+\.\d+ check --strict/);
  assert.doesNotMatch(wf, /verify/);
});

test('with any owner known by email, a name-only owner cannot be claimed by --by alone', async () => {
  const dir = await project(['--owner', 'Ana <ana@x.io>', '--owner', 'Carl']);
  const r = JSON.parse((await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'bob', '--decision', '50%.'])).out);
  await as('bob@x.io', async () => {
    assert.match((await keel(dir, ['decision', 'accept', r.id, '--by', 'Carl', '--quote', 'ok'])).err, /Carl has no email in \.keel\/project\.json owners/);
  });
});

test('a product rule is superseded only by an accepted record from the owner', async () => {
  const dir = await project(['--owner', 'Ana <ana@x.io>']);
  await as('ana@x.io', () => keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'Ana', '--status', 'accepted', '--quote', 'half', '--decision', '50%.']));
  const sup = ['decision', 'new', '--area', 'D', '--title', 'Renters get nothing back late', '--kind', 'product', '--decision', '0%.', '--supersedes', 'D-001'];
  await as('bob@x.io', async () => {
    assert.match((await keel(dir, [...sup, '--by', 'bob'])).err, /superseded only by an accepted record/);
    assert.match((await keel(dir, [...sup, '--by', 'Ana', '--status', 'accepted', '--quote', 'none'])).err, /git identity is bob@x\.io/);
  });
});

test('merge: an item renumbered in an earlier merge is still the same item later; unreadable JSON stops the merge', async () => {
  const { mergeStore, runMergeDriver } = await import('../src/team.mjs');
  const q = (id, uid, text) => ({ id, uid, question: text });
  // Earlier merge: their engineering question (uid e) became #2 on main. Now "other" answers it as its #1.
  const base = { lastId: 1, open: [q(1, 'e', 'engineering')] };
  const ours = { lastId: 2, open: [q(1, 'p', 'product'), q(2, 'e', 'engineering')] };
  const theirs = { lastId: 1, open: [], closed: [{ id: 1, uid: 'e', answered: '2026-11-25' }] };
  const { merged } = mergeStore('questions', base, ours, theirs);
  assert.deepEqual(merged.open.map((x) => [x.id, x.uid]), [[1, 'p']]);

  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-merge-'));
  for (const [n, text] of [['o', '{"lastId":1,"open":[]}'], ['a', '{"lastId":1,"open":[]}'], ['b', '{"lastId": 2, <<<<<<< broken']]) fs.writeFileSync(path.join(dir, n), text);
  assert.throws(() => runMergeDriver('.keel/questions.json', path.join(dir, 'o'), path.join(dir, 'a'), path.join(dir, 'b')), /not valid JSON/);
});

test('merge: a feature both sides changed keeps each side\'s field changes and their test links', async () => {
  const { mergeStore } = await import('../src/team.mjs');
  const base = { 'a.b': { title: 'T', status: 'building', decisions: [], checks: { 1: 'one' }, lastCheck: 1, files: [] } };
  const ours = { 'a.b': { ...base['a.b'], holder: { by: 'ana', since: 'x' } } };
  const theirs = { 'a.b': { ...base['a.b'], status: 'built', risk: 'high', checks: { 1: 'one', 2: 'two' }, lastCheck: 2, links: { 2: 't.test.js::two' } } };
  const f = mergeStore('features', base, ours, theirs).merged['a.b'];
  assert.equal(f.status, 'built');
  assert.equal(f.risk, 'high');
  assert.deepEqual(f.holder, { by: 'ana', since: 'x' });
  assert.deepEqual(f.links, { 2: 't.test.js::two' });
  assert.deepEqual(f.checks, { 1: 'one', 2: 'two' });
});
