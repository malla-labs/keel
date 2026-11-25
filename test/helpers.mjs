import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.mjs';

process.env.KEEL_TODAY = '2026-11-25';

/** Runs the CLI in `dir`. Returns { code, out, err }. */
export async function keel(dir, args, stdin = '') {
  const prev = process.cwd();
  process.chdir(dir);
  const out = [];
  const err = [];
  try {
    const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: async () => stdin });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    process.chdir(prev);
  }
}

export async function project(opts = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-test-'));
  const r = await keel(dir, ['init', '--name', 'demo', ...opts]);
  if (r.code !== 0) throw new Error(r.err);
  return dir;
}

export function write(dir, rel, text) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

export function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

export const productQuestion = [
  'question', 'add', '--kind', 'product',
  '--question', 'What refund does a renter get when cancelling 24 to 48 hours before pickup?',
  '--blocks', 'Check 3 of booking.cancel needs the number.',
  '--option', '*50% refund', '--option', 'No refund',
  '--default', 'A, built as a settings value.',
];

export async function decision(dir, extra = []) {
  const r = await keel(dir, ['decision', 'new', '--area', 'P', '--title', 'Bookings are stored in Postgres', '--kind', 'engineering', '--by', 'lead', '--status', 'accepted', '--decision', 'All bookings live in Postgres.', ...extra]);
  if (r.code !== 0) throw new Error(r.err);
  return JSON.parse(r.out);
}
