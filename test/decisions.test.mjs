import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decision, keel, project, read } from './helpers.mjs';

test('numbers follow the highest id in the area and are never reused', async () => {
  const dir = await project();
  assert.equal((await decision(dir)).id, 'P-001');
  assert.equal((await decision(dir)).id, 'P-002');
  assert.equal((await keel(dir, ['decision', 'next', 'P'])).out, 'P-003');
  assert.equal((await keel(dir, ['decision', 'next', 'D'])).out, 'D-001');
});

test('a record has the header check expects and passes check', async () => {
  const dir = await project();
  const r = await decision(dir);
  const text = read(dir, r.file);
  assert.match(text, /^# P-001: Bookings are stored in Postgres\n\nStatus: accepted \(lead, 2026-11-25\)\nKind: engineering\n/);
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('only an owner accepts a product rule, and must be quoted', async () => {
  const dir = await project();
  const base = ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--decision', '50% refund 24-48h before pickup.'];
  const byLead = await keel(dir, [...base, '--by', 'lead', '--status', 'accepted']);
  assert.equal(byLead.code, 1);
  assert.match(byLead.err, /Only an owner/);
  const noQuote = await keel(dir, [...base, '--by', 'owner', '--status', 'accepted']);
  assert.match(noQuote.err, /must quote the owner/);
  const ok = await keel(dir, [...base, '--by', 'owner', '--status', 'accepted', '--quote', 'half back, simple']);
  assert.equal(ok.code, 0);
  assert.match(read(dir, JSON.parse(ok.out).file), /The owner, 2026-11-25: "half back, simple"/);
});

test('a product rule defaults to proposed when the lead writes it', async () => {
  const dir = await project();
  const r = await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'lead', '--decision', '50%.']);
  assert.equal(JSON.parse(r.out).status, 'proposed');
});

test('superseding marks the old record and the new one names it', async () => {
  const dir = await project();
  const old = await decision(dir);
  const neu = await decision(dir, ['--supersedes', old.id]);
  assert.match(read(dir, old.file), /^Status: superseded by P-002 \(lead, 2026-11-25\)$/m);
  assert.match(read(dir, neu.file), /Replaces P-001/);
  const again = await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Another storage rule', '--kind', 'engineering', '--by', 'lead', '--decision', 'x', '--supersedes', old.id]);
  assert.match(again.err, /already superseded by P-002/);
  assert.equal((await keel(dir, ['check'])).code, 0);
});

test('a reason nobody gave is written as unknown, never guessed', async () => {
  const dir = await project();
  const r = await decision(dir);
  assert.match(read(dir, r.file), /## Why\n\nUnknown\. Needs the owner's answer:/);
});

test('accepting a proposed product rule needs the owner', async () => {
  const dir = await project();
  const r = JSON.parse((await keel(dir, ['decision', 'new', '--area', 'D', '--title', 'Renters get half back late', '--kind', 'product', '--by', 'lead', '--decision', '50%.'])).out);
  assert.match((await keel(dir, ['decision', 'accept', r.id, '--by', 'lead'])).err, /Only an owner/);
  assert.equal((await keel(dir, ['decision', 'accept', r.id, '--by', 'owner', '--quote', 'yes'])).code, 0);
  assert.match(read(dir, r.file), /^Status: accepted \(owner, 2026-11-25\)$/m);
});

test('the brief says whether the person in the session is the owner', async () => {
  const team = await project();
  assert.match((await keel(team, ['brief'])).out, /not known to be an owner: a product rule they state is --status proposed/);
  const solo = await project(['--owner', 'josue', '--session-owner']);
  assert.match((await keel(solo, ['brief'])).out, /Owner: the person in this session is the owner \(josue\)/);
});
