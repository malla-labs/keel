import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decision, keel, project } from './helpers.mjs';

const edit = (dir, rel) => JSON.stringify({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel) } });
const bash = (dir, command) => JSON.stringify({ cwd: dir, tool_name: 'Bash', tool_input: { command } });

async function scoped() {
  const dir = await project();
  await keel(dir, ['feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--files', 'src/bookings/**']);
  await keel(dir, ['scope', 'start', 'booking.cancel']);
  return dir;
}

test('with a scope, edits outside it are blocked and inside it allowed', async () => {
  const dir = await scoped();
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'src/bookings/cancel.ts'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'docs/notes.md'))).code, 0);
  const out = await keel(dir, ['hook', 'guard'], edit(dir, 'src/payments/pay.ts'));
  assert.equal(out.code, 2);
  assert.match(out.err, /outside the scope of booking\.cancel/);
});

test('widening needs a reason and then allows the path', async () => {
  const dir = await scoped();
  assert.match((await keel(dir, ['scope', 'widen', 'src/payments/**'])).err, /--reason is required/);
  await keel(dir, ['scope', 'widen', 'src/payments/**', '--reason', 'refund calls the payment port']);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'src/payments/pay.ts'))).code, 0);
});

test('dependency changes need a decision, by file or by install command', async () => {
  const dir = await project();
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'package.json'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'pnpm add zod'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'pnpm install'))).code, 0);
  assert.match((await keel(dir, ['scope', 'deps', 'P-001'])).err, /does not exist/);
  await decision(dir);
  await keel(dir, ['scope', 'deps', 'P-001']);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'pnpm add zod'))).code, 0);
});

test('generated and CLI-owned files cannot be edited by hand or by shell', async () => {
  const dir = await project();
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'docs/decisions/OPEN_QUESTIONS.md'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, '.keel/questions.json'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, "echo '{}' > .keel/features.json"))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'cat .keel/features.json'))).code, 0);
});

test('light mode keeps only the generated-file guard', async () => {
  const dir = await project(['--mode', 'light']);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'package.json'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'docs/decisions/OPEN_QUESTIONS.md'))).code, 2);
});

test('hooks allow everything outside a keel project and on bad input', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nokeel-'));
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'package.json'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], 'not json')).code, 0);
});

test('the stop hook blocks once on failing changed files, then lets go', async () => {
  const dir = await project();
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const fs = await import('node:fs');
  fs.writeFileSync(path.join(dir, 'a.test.ts'), "test('x', () => {});\n");
  const first = await keel(dir, ['hook', 'stop'], JSON.stringify({ cwd: dir }));
  assert.equal(first.code, 2);
  assert.match(first.err, /a\.test\.ts:1: test cites nothing/);
  assert.equal((await keel(dir, ['hook', 'stop'], JSON.stringify({ cwd: dir, stop_hook_active: true }))).code, 0);
});

test('the rules file cannot be edited by the work it checks', async () => {
  const dir = await project();
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, '.keel/project.json'))).code, 2);
});

test('the stop gate lets through after its block limit, saying what still fails', async () => {
  const dir = await project();
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const fs = await import('node:fs');
  fs.writeFileSync(path.join(dir, 'a.test.ts'), "test('x', () => {});\n");
  const ev = JSON.stringify({ cwd: dir, session_id: 's1' });
  assert.equal((await keel(dir, ['hook', 'stop'], ev)).code, 2);
  assert.equal((await keel(dir, ['hook', 'stop'], ev)).code, 2);
  const third = await keel(dir, ['hook', 'stop'], ev);
  assert.equal(third.code, 0);
  assert.match(third.out, /let through after 2 blocks/);
  assert.equal((await keel(dir, ['hook', 'stop'], JSON.stringify({ cwd: dir, session_id: 's2' }))).code, 2);
});

test('observe mode logs what it would block and lets go', async () => {
  const dir = await project();
  const fs = await import('node:fs');
  const f = path.join(dir, '.keel/project.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), gate: 'observe' }));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.test.ts'), "test('x', () => {});\n");
  assert.equal((await keel(dir, ['hook', 'stop'], JSON.stringify({ cwd: dir }))).code, 0);
  assert.match(fs.readFileSync(path.join(dir, '.keel/gate.log'), 'utf8'), /would have blocked/);
});

test('Claude may not skip git hooks', async () => {
  const dir = await project();
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git commit --no-verify -m x'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git commit -nm x'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git push --no-verify'))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git commit -m "no verify needed"'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git log -n 5'))).code, 0);
});

test('in full mode, code cannot change while no feature is in progress; docs can', async () => {
  const dir = await project();
  const r = await keel(dir, ['hook', 'guard'], edit(dir, 'src/a.ts'));
  assert.equal(r.code, 2);
  assert.match(r.err, /No feature is in progress/);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'docs/notes.md'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], edit(dir, 'catalogue/poses.json'))).code, 0);
});

test('a Bash write is judged like an edit, after a leading cd', async () => {
  const dir = await scoped();
  const blocked = await keel(dir, ['hook', 'guard'], bash(dir, "cat > src/payments/pay.ts <<'EOF'\nx\nEOF"));
  assert.equal(blocked.code, 2);
  assert.match(blocked.err, /outside the scope[\s\S]*This Bash command writes src\/payments\/pay\.ts/);
  assert.equal((await keel(dir, ['hook', 'guard'], bash('/', `cd ${dir} && echo x >> src/payments/pay.ts`))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'echo x > src/bookings/a.ts 2>&1'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'node x.mjs > /dev/null 2>&1'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'cat > package.json <<EOF\n{}\nEOF'))).code, 2);
});

test('package.json: scripts may change freely, dependencies need a decision', async () => {
  const dir = await project();
  const fs = await import('node:fs');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' }, dependencies: { a: '1' } }));
  const write = (content) => JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'package.json'), content } });
  assert.equal((await keel(dir, ['hook', 'guard'], write(JSON.stringify({ scripts: { test: 'y' }, dependencies: { a: '1' } })))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], write(JSON.stringify({ scripts: { test: 'x' }, dependencies: { a: '1', zod: '3' } })))).code, 2);
  const ed = (o, n) => JSON.stringify({ cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'package.json'), old_string: o, new_string: n } });
  assert.equal((await keel(dir, ['hook', 'guard'], ed('"test":"x"', '"test":"z"'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], ed('"a":"1"', '"a":"2"'))).code, 2);
});

test('text inside quotes and heredocs is never read as a redirect', async () => {
  const dir = await scoped();
  const msg = "git commit -F - <<'EOF'\nAdd cancel\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF";
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, msg))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, 'git commit -m "a > b: <x@y.z>"'))).code, 0);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, "echo 'x' > src/payments/p.ts"))).code, 2);
  assert.equal((await keel(dir, ['hook', 'guard'], bash(dir, "cat > src/payments/p.ts <<'EOF'\nconst a = b > c;\nEOF"))).code, 2);
});
