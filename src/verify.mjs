import { spawnSync } from 'node:child_process';
import { fail } from './util.mjs';

const TAIL_LINES = 3;
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The commands that prove a change, from `verify` in project.json: the tests (`quick`, or `full`),
 * then `lint` and `types` when the owner set them. A missing test command is an error: there is
 * nothing to run.
 */
export function verifySteps(cfg, { full = false } = {}) {
  const v = cfg.verify ?? {};
  const tests = full ? v.full ?? v.quick : v.quick;
  if (!tests) fail(`No ${full ? 'verify.full or ' : ''}verify.quick command in .keel/project.json.`, 'The owner sets it (for example "npm test"); keel cannot verify without a test command.');
  return [
    { name: full && v.full ? 'full' : 'quick', command: tests },
    ...(v.lint ? [{ name: 'lint', command: v.lint }] : []),
    ...(v.types ? [{ name: 'types', command: v.types }] : []),
  ];
}

/**
 * Runs every step in the project root and stops at the first failure. Returns each step run with
 * its exit status and the last lines of its output: the evidence a verification records.
 */
export function runVerify(project, opts = {}) {
  const results = [];
  for (const step of verifySteps(project.cfg, opts)) {
    const r = spawnSync(step.command, { cwd: project.root, shell: true, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
    const ok = r.status === 0;
    const tail = output.split('\n').filter((l) => l.trim()).slice(-TAIL_LINES);
    results.push({ ...step, ok, status: r.status ?? (r.error ? r.error.code : 'killed'), tail });
    if (!ok) break;
  }
  return { ok: results.every((s) => s.ok), steps: results };
}

/** One line per step, for the terminal and for a verification's evidence. */
export function formatVerify(r) {
  return r.steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}: ${s.command}${s.tail.length ? `\n      ${s.tail.join('\n      ')}` : ''}`).join('\n');
}

/** What a verification records when keel ran the commands itself. */
export function verifyRecord(r) {
  return {
    command: r.steps.map((s) => s.command).join(' && '),
    evidence: r.steps.map((s) => `${s.name}: ${s.tail.at(-1) ?? 'no output'}`),
  };
}
