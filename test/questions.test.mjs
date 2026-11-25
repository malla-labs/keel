import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keel, productQuestion, project, read } from './helpers.mjs';

test('a question that breaks the pattern is refused with every problem listed', async () => {
  const dir = await project();
  const r = await keel(dir, ['question', 'add', '--kind', 'product', '--question', 'Refund? And fees?', '--option', 'Yes', '--option', 'No']);
  assert.equal(r.code, 1);
  for (const p of ['one "?"', 'blocks is empty', 'exactly one option must be recommended', 'default is empty']) assert.ok(r.err.includes(p), p);
});

test('a valid question is numbered and rendered in the pattern', async () => {
  const dir = await project();
  const r = await keel(dir, productQuestion);
  assert.deepEqual(JSON.parse(r.out), { id: 1, kind: 'product' });
  const md = read(dir, 'docs/decisions/OPEN_QUESTIONS.md');
  assert.match(md, /### Q-1 · product\n\n\*\*Question:\*\* What refund/);
  assert.match(md, /- A\) 50% refund \*\*\(recommended\)\*\*\n- B\) No refund\n/);
  assert.match(read(dir, 'docs/STATE.md'), /- Q-1: What refund/);
});

test('the same question cannot be open twice', async () => {
  const dir = await project();
  await keel(dir, productQuestion);
  assert.match((await keel(dir, productQuestion)).err, /already open as Q-1/);
});

test('only an owner answers a product question; numbers are never reused', async () => {
  const dir = await project();
  await keel(dir, productQuestion);
  assert.match((await keel(dir, ['question', 'answer', 'Q-1', '--answer', 'A', '--by', 'lead'])).err, /only an owner/);
  const ok = await keel(dir, ['question', 'answer', 'Q-1', '--answer', 'A', '--by', 'owner', '--quote', 'half']);
  assert.equal(ok.code, 0);
  assert.match(read(dir, 'docs/decisions/RESOLUTIONS_2026-11-25.md'), /\| Q-1 \| What refund.*\| A\) 50% refund \("half"\) \| owner \|/);
  assert.match(read(dir, 'docs/decisions/OPEN_QUESTIONS.md'), /## For the owner\n\nNone\./);
  const next = await keel(dir, [...productQuestion.slice(0, 5), 'Is a no-show refunded at all?', ...productQuestion.slice(6)]);
  assert.equal(JSON.parse(next.out).id, 2);
});

test('an answer with work lands on the feature and in the state', async () => {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking']);
  await keel(dir, [...productQuestion, '--feature', 'booking.cancel']);
  await keel(dir, ['question', 'answer', '1', '--answer', 'A', '--by', 'owner', '--work', 'Add the 50% band to the refund calculator']);
  assert.match(read(dir, 'docs/STATE.md'), /`booking.cancel`: Add the 50% band to the refund calculator \(Q-1, 2026-11-25\)/);
});

test('a hand edit of the generated file is caught by check', async () => {
  const dir = await project();
  await keel(dir, productQuestion);
  const fs = await import('node:fs');
  fs.appendFileSync(`${dir}/docs/decisions/OPEN_QUESTIONS.md`, '\nextra\n');
  const r = await keel(dir, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /out of date/);
});

test('two questions joined by "and does" are refused; typed option labels are stripped', async () => {
  const dir = await project();
  const joined = [...productQuestion.slice(0, 5), 'What refund applies under 24 hours, and does exactly 24 hours count as the 50% band?', ...productQuestion.slice(6)];
  assert.match((await keel(dir, joined)).err, /ask one thing: it joins a second question/);
  const labelled = productQuestion.map((a) => (a === '*50% refund' ? '*A) 50% refund' : a === 'No refund' ? 'B. No refund' : a));
  await keel(dir, labelled);
  assert.match(read(dir, 'docs/decisions/OPEN_QUESTIONS.md'), /- A\) 50% refund \*\*\(recommended\)\*\*\n- B\) No refund\n/);
});

test('a withdrawn question leaves the list and is filed with its reason', async () => {
  const dir = await project();
  await keel(dir, productQuestion);
  assert.match((await keel(dir, ['question', 'withdraw', '1', '--by', 'lead'])).err, /--reason is required/);
  assert.equal((await keel(dir, ['question', 'withdraw', 'Q-1', '--by', 'lead', '--reason', 'split into Q-2 and Q-3'])).code, 0);
  assert.match(read(dir, 'docs/decisions/RESOLUTIONS_2026-11-25.md'), /\| Q-1 \| .* \| Withdrawn: split into Q-2 and Q-3 \| lead \|/);
  assert.equal((await keel(dir, ['check'])).code, 0);
});
