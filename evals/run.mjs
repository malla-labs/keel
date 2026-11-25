#!/usr/bin/env node
// Runs keel's scenarios as real headless Claude sessions and grades each run with code, not a model.
// Usage: node evals/run.mjs [--runs 3] [--jobs 4] [--only name,name] [--model sonnet] [--out DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarios } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const runs = Number(args.runs ?? 3);
const jobs = Number(args.jobs ?? 4);
const model = args.model ?? 'sonnet';
const only = args.only ? args.only.split(',') : null;
const out = path.resolve(args.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'keel-evals-')));
fs.mkdirSync(out, { recursive: true });

const list = scenarios.filter((s) => !only || only.includes(s.name));
const queue = list.flatMap((s) => Array.from({ length: runs }, (_, i) => ({ s, i: i + 1 })));
const results = [];

function claude(dir, s, log) {
  return new Promise((resolve) => {
    const argv = ['-p', '--model', model, '--permission-mode', 'acceptEdits', '--no-session-persistence', '--max-turns', String(s.maxTurns ?? 60), '--allowedTools', ...s.tools, '--', s.prompt];
    const child = spawn('claude', argv, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), (s.timeout ?? 900) * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.writeFileSync(log, text);
      resolve({ code, text });
    });
  });
}

async function one({ s, i }) {
  const dir = path.join(out, s.name, `run-${i}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  await s.setup(dir);
  const { code, text } = args.dry ? { code: 0, text: '' } : await claude(dir, s, path.join(out, s.name, `run-${i}.log`));
  let checks;
  try { checks = await s.grade(dir, text); } catch (e) { checks = [{ name: 'grader crashed', pass: false, detail: e.message }]; }
  const r = { scenario: s.name, run: i, exit: code, seconds: Math.round((Date.now() - t0) / 1000), pass: checks.every((c) => c.pass), checks };
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${s.name} #${i} (${r.seconds}s)${r.pass ? '' : ': ' + checks.filter((c) => !c.pass).map((c) => c.name + (c.detail ? ` [${c.detail}]` : '')).join('; ')}`);
}

const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) await one(queue.shift());
});
await Promise.all(workers);

const summary = list.map((s) => {
  const rs = results.filter((r) => r.scenario === s.name).sort((a, b) => a.run - b.run);
  return { scenario: s.name, passed: rs.filter((r) => r.pass).length, runs: rs.length, failures: rs.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `#${r.run} ${c.name}`)) };
});
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ model, runs, summary, results }, null, 2));
console.log('\nScenario'.padEnd(22) + 'Passed');
for (const x of summary) console.log(`${x.scenario.padEnd(21)} ${x.passed}/${x.runs}${x.failures.length ? '  ' + x.failures.join('; ') : ''}`);
const total = summary.reduce((a, x) => a + x.passed, 0);
console.log(`\nTotal ${total}/${results.length}. Logs and fixtures: ${out}`);
process.exitCode = total === results.length ? 0 : 1;
