// keel's scenarios. Each sets up a fresh project, gives Claude one prompt, and grades the result
// with code: the files, git, and keel's own CLI. A run passes only when every check passes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KEEL = fileURLToPath(new URL('../bin/keel', import.meta.url));
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'e@e', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'e@e' };

function keel(dir, ...args) {
  const r = spawnSync('node', [KEEL, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function keelJSON(dir, ...args) {
  const r = keel(dir, ...args);
  if (r.code !== 0) throw new Error(`keel ${args.join(' ')}: ${r.err}`);
  return JSON.parse(r.out);
}
function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: GIT_ENV }).stdout.trim();
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
function read(dir, rel) {
  try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}
function commit(dir, msg) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', msg);
}
function setConfig(dir, patch) {
  const f = path.join(dir, '.keel/project.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch }, null, 2) + '\n');
}
function history(dir) {
  return read(dir, '.keel/history.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function decisions(dir) {
  const r = keel(dir, 'decision', 'list');
  return r.out.split('\n').filter(Boolean).map((l) => {
    const [id, status, kind, ...title] = l.trim().split(/\s+/);
    return { id, status, kind, title: title.join(' ') };
  });
}
function recordText(dir, id) {
  for (const area of ['platform', 'shared', 'product']) {
    const d = path.join(dir, 'docs/decisions', area);
    if (!fs.existsSync(d)) continue;
    const f = fs.readdirSync(d).find((n) => n.startsWith(id + '-'));
    if (f) return fs.readFileSync(path.join(d, f), 'utf8');
  }
  return '';
}
/** Files changed since the setup commit (the first commit), committed or not. */
function changedSince(dir) {
  const base = git(dir, 'rev-list', '--max-parents=0', 'HEAD');
  const committed = git(dir, 'diff', '--name-only', base, 'HEAD').split('\n');
  const work = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
  return [...new Set([...committed, ...work].filter(Boolean))];
}
const ok = (name, pass, detail = '') => ({ name, pass: Boolean(pass), detail: pass ? '' : String(detail).replace(/\s+/g, ' ').trim().slice(0, 160) });
const checkPasses = (dir) => {
  const r = keel(dir, 'check');
  return ok('keel check passes', r.code === 0, r.out.split('\n').filter((l) => l.startsWith('ERROR')).slice(0, 2).join(' | ') || r.err);
};

const TOOLS = ['Bash(keel *)', 'Bash(node *)', 'Bash(git *)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(grep *)', 'Bash(mkdir *)', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill', 'Agent'];

/** A small rentals project with keel set up: areas P and S, owner "owner", a payments module. */
function rentals(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  write(dir, 'package.json', JSON.stringify({ name: 'rentals', type: 'module', private: true }, null, 2) + '\n');
  write(dir, 'src/payments/refund.mjs', '// Sends a refund to the payment provider. Amounts are integer cents.\nexport function refund(bookingId, cents) {\n  if (!Number.isInteger(cents)) throw new TypeError(\'cents must be an integer\');\n  return { bookingId, cents };\n}\n');
  keel(dir, 'init', '--name', 'rentals');
  fs.rmSync(path.join(dir, 'docs/decisions/product'), { recursive: true, force: true });
  setConfig(dir, {
    areas: {
      P: { folder: 'platform', about: 'Infrastructure, code structure, libraries, security' },
      S: { folder: 'shared', about: 'Rules binding renter and host: bookings, cancellation, refunds, pricing' },
    },
    owners: ['owner'],
    verify: { quick: 'node --test "src/**/*.test.mjs"', full: 'node --test "src/**/*.test.mjs"', app: null },
  });
  keel(dir, 'summary', 'set', '--text', 'Rentals: a car-rental marketplace where renters book cars from hosts.\nCode: plain JavaScript ES modules in src/, tests with node:test (`node --test "src/**/*.test.mjs"`).\nPayments: src/payments/refund.mjs sends refunds in integer cents.');
}

const S001 = ['decision', 'new', '--area', 'S', '--kind', 'product', '--by', 'owner', '--status', 'accepted',
  '--title', 'Renter refunds depend on how early the renter cancels',
  '--decision', 'More than 48 hours before pickup: 100% refund. From 24 to 48 hours: 50%. Under 24 hours: 0%. Amounts in integer cents, rounded down.',
  '--quote', 'more than 48h everything back, 24 to 48h half, under 24h nothing'];

function cancelCode() {
  return `// Decision: S-001
import { refund as paymentsRefund } from '../payments/refund.mjs';

const HOUR = 3_600_000;

export function refundPercent(pickupAt, cancelAt) {
  const hours = (new Date(pickupAt) - new Date(cancelAt)) / HOUR;
  if (hours > 48) return 100;
  if (hours >= 24) return 50;
  return 0;
}

export function cancel({ bookingId, paidCents, pickupAt, cancelAt }, { refund = paymentsRefund } = {}) {
  const percent = refundPercent(pickupAt, cancelAt);
  const cents = Math.floor((paidCents * percent) / 100);
  return { bookingId, percent, cents, refunded: cents > 0 ? refund(bookingId, cents) : null };
}
`;
}
const cancelTest = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundPercent, cancel } from './cancel.mjs';

const pickup = new Date('2026-12-10T12:00:00Z');
const before = (h) => new Date(pickup.getTime() - h * 3_600_000);

// Covers: booking.cancel#1
test('more than 48h refunds 100%', () => assert.equal(refundPercent(pickup, before(49)), 100));
// Covers: booking.cancel#2
test('24 to 48h refunds 50%', () => assert.equal(refundPercent(pickup, before(36)), 50));
// Covers: booking.cancel#3
test('under 24h refunds 0%', () => assert.equal(refundPercent(pickup, before(5)), 0));
// Covers: booking.cancel#4
test('calls payments with cents', () => {
  const calls = [];
  cancel({ bookingId: 'b1', paidCents: 10001, pickupAt: pickup, cancelAt: before(36) }, { refund: (...a) => calls.push(a) });
  assert.deepEqual(calls, [['b1', 5000]]);
});
`;
/** rentals plus a built, verified booking.cancel feature. */
function rentalsWithCancel(dir) {
  rentals(dir);
  keel(dir, ...S001);
  keel(dir, 'feature', 'add', 'booking.cancel', '--title', 'A renter cancels a booking and is refunded by how early', '--status', 'built', '--files', 'src/bookings/**');
  for (const c of ['More than 48h before pickup refunds 100%', '24 to 48h before pickup refunds 50%', 'Under 24h before pickup refunds 0%', 'Cancelling calls payments refund with the cents']) keel(dir, 'feature', 'check', 'booking.cancel', '--add', c);
  keel(dir, 'feature', 'set', 'booking.cancel', '--decision', 'S-001');
  write(dir, 'src/bookings/cancel.mjs', cancelCode());
  write(dir, 'src/bookings/cancel.test.mjs', cancelTest);
  keel(dir, 'feature', 'verified', 'booking.cancel', '--command', 'node --test "src/**/*.test.mjs"');
}
const testsPass = (dir) => {
  const r = spawnSync('node', ['--test', 'src/**/*.test.mjs'], { cwd: dir, encoding: 'utf8' });
  return ok('project tests pass', r.status === 0, (r.stdout + r.stderr).split('\n').filter((l) => /fail|Error/.test(l)).slice(0, 2).join(' | '));
};

export const scenarios = [
  {
    name: 'decide-rule',
    prompt: 'I am the owner. New rule: a renter who cancels between 24 and 48 hours before pickup gets 50% back; earlier than that, everything back.',
    tools: TOOLS,
    maxTurns: 40,
    setup(dir) { rentals(dir); commit(dir, 'setup'); },
    grade(dir) {
      const recs = decisions(dir).filter((d) => d.id.startsWith('S-'));
      const r = recs[0];
      const text = r ? recordText(dir, r.id) : '';
      const qs = JSON.parse(read(dir, '.keel/questions.json') || '{"open":[]}').open;
      return [
        ok('one shared record written', recs.length === 1, recs.map((x) => x.id).join(',')),
        ok('accepted product rule by the owner', r?.status === 'accepted' && r?.kind === 'product' && /Status: accepted \(owner,/.test(text), r && `${r.status} ${r.kind}`),
        ok('owner quoted with date', /The owner, \d{4}-\d{2}-\d{2}: "/.test(text) && /50/.test(text)),
        ok('the open case (under 24h) is asked as a product question', qs.some((q) => q.kind === 'product' && /24/.test(q.question)), `${qs.length} questions`),
        ok('no code written', !changedSince(dir).some((f) => f.startsWith('src/'))),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'decide-conflict',
    prompt: 'I am the owner. Change of plan: between 24 and 48 hours before pickup, renters now get 30% back, not 50%.',
    tools: TOOLS,
    maxTurns: 40,
    setup(dir) { rentals(dir); keel(dir, ...S001); commit(dir, 'setup'); },
    grade(dir, output) {
      const old = recordText(dir, 'S-001');
      const neu = recordText(dir, 'S-002');
      return [
        ok('S-001 marked superseded by S-002', /^Status: superseded by S-002/m.test(old)),
        ok('S-002 accepted, owner, quoted, says 30%', /Status: accepted \(owner,/.test(neu) && /The owner, [\d-]+: "/.test(neu) && /30/.test(neu)),
        ok('S-002 names what it replaces', /S-001/.test(neu)),
        ok('the reply names the contradicted record', /S-001/.test(output)),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'ask-product',
    prompt: 'Next feature: booking.extend, a renter extends an active trip. Prepare it for building (checks, decisions, open questions), but do not write code yet.',
    tools: TOOLS,
    maxTurns: 50,
    setup(dir) { rentals(dir); commit(dir, 'setup'); },
    grade(dir) {
      const f = JSON.parse(read(dir, '.keel/features.json') || '{}')['booking.extend'];
      const qs = JSON.parse(read(dir, '.keel/questions.json') || '{"open":[]}').open;
      const productByLead = decisions(dir).filter((d) => d.kind === 'product' && d.status === 'accepted');
      return [
        ok('feature registered', Boolean(f)),
        ok('at least 2 checks written', f && Object.keys(f.checks).length >= 2, f && Object.keys(f.checks).length),
        ok('product questions asked in the pattern, linked to the feature', qs.some((q) => q.kind === 'product' && q.feature === 'booking.extend')),
        ok('no product rule accepted without the owner', productByLead.length === 0, productByLead.map((d) => d.id).join(',')),
        ok('no code written', !changedSince(dir).some((x) => x.startsWith('src/'))),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'answer',
    prompt: 'I am the owner. Q-1: B.',
    tools: TOOLS,
    maxTurns: 40,
    setup(dir) {
      rentals(dir);
      keel(dir, 'decision', 'new', '--area', 'S', '--kind', 'product', '--by', 'owner', '--status', 'accepted', '--title', 'Renters get half back when cancelling 24 to 48 hours before pickup', '--decision', 'More than 48h: 100%. 24 to 48h: 50%. Under 24h: open, Q-1.', '--quote', '24 to 48h half, earlier everything');
      keel(dir, 'feature', 'add', 'booking.cancel', '--title', 'Cancel a booking', '--files', 'src/bookings/**');
      keel(dir, 'question', 'add', '--kind', 'product', '--feature', 'booking.cancel', '--decision', 'S-001', '--question', 'What refund does a renter get when cancelling under 24 hours before pickup?', '--blocks', 'booking.cancel needs a refund for every cancellation time.', '--option', '*No refund', '--option', '25% refund', '--option', 'Full refund minus the service fee', '--default', 'A, as a settings value.');
      commit(dir, 'setup');
    },
    grade(dir) {
      const qs = JSON.parse(read(dir, '.keel/questions.json')).open;
      const res = fs.readdirSync(path.join(dir, 'docs/decisions')).filter((n) => n.startsWith('RESOLUTIONS_')).map((n) => read(dir, `docs/decisions/${n}`)).join('\n');
      const recs = decisions(dir);
      const rule = recs.filter((d) => d.id !== 'S-001' && d.status === 'accepted' && d.kind === 'product').map((d) => recordText(dir, d.id)).find((t) => /25/.test(t));
      return [
        ok('Q-1 is no longer open', !qs.some((q) => q.id === 1)),
        ok('answer filed in the resolutions with 25%', /Q-1/.test(res) && /25%/.test(res)),
        ok('a rule record states 25%, accepted by the owner', Boolean(rule) && /Status: accepted \(owner,/.test(rule)),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'feature-build',
    prompt: 'Build booking.cancel: given the pickup time and the cancel time, return the refund percent per S-001, and call the payments refund with the amount in cents. Plain JavaScript ES modules, node:test for tests.',
    tools: TOOLS,
    maxTurns: 90,
    timeout: 1200,
    setup(dir) { rentals(dir); keel(dir, ...S001); commit(dir, 'setup'); },
    grade(dir) {
      const f = JSON.parse(read(dir, '.keel/features.json'))['booking.cancel'];
      const p = keelJSON(dir, 'progress', '--json').features.find((x) => x.id === 'booking.cancel');
      const changed = changedSince(dir);
      const globs = (f?.files ?? []).map((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$'));
      const outside = changed.filter((x) => !/^(docs\/|\.keel\/)/.test(x) && !globs.some((re) => re.test(x)));
      const code = changed.filter((x) => /\.m?js$/.test(x) && !x.includes('.test.')).map((x) => read(dir, x)).join('\n');
      return [
        ok('feature built', f?.status === 'built', f?.status),
        ok('at least 3 checks', f && Object.keys(f.checks).length >= 3),
        ok('every check has a test', p && p.covered === p.checks && p.checks > 0, p && `${p.covered}/${p.checks}`),
        ok('verification recorded and current', p?.verified === 'yes', p?.verified),
        testsPass(dir),
        ok('code cites S-001', /Decision: S-001/.test(code)),
        ok('only the feature\'s own files changed', f?.files?.length > 0 && outside.length === 0, outside.join(',')),
        ok('scope started and cleared', history(dir).some((e) => e.type === 'scope.start') && !fs.existsSync(path.join(dir, '.keel/scope.json'))),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'scope-widen',
    prompt: 'Change booking.cancel: every refund must carry a reason ("renter_cancel"), so payments refund must take (bookingId, cents, reason). Update both modules and their tests.',
    tools: TOOLS,
    maxTurns: 80,
    timeout: 1200,
    setup(dir) { rentalsWithCancel(dir); commit(dir, 'setup'); },
    grade(dir) {
      const h = history(dir);
      const payChanged = read(dir, 'src/payments/refund.mjs').includes('reason');
      const widen = h.find((e) => ((e.type === 'scope.widen' && /payments/.test(e.glob)) || (e.type === 'feature.files' && e.added.some((g) => /payments/.test(g)))) && e.reason);
      return [
        ok('payments refund takes a reason', payChanged),
        ok('a scope was started for the work', h.some((e) => e.type === 'scope.start')),
        ok('scope widened to payments with a reason', Boolean(widen)),
        testsPass(dir),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'deps',
    prompt: 'Add input validation to booking.cancel using the zod library.',
    tools: [...TOOLS, 'Bash(npm *)', 'Bash(pnpm *)'],
    maxTurns: 70,
    timeout: 1200,
    setup(dir) { rentalsWithCancel(dir); commit(dir, 'setup'); },
    grade(dir) {
      const pkg = JSON.parse(read(dir, 'package.json'));
      const added = Boolean(pkg.dependencies?.zod || pkg.devDependencies?.zod);
      const zodRecord = decisions(dir).find((d) => /zod/i.test(d.title) || /zod/i.test(recordText(dir, d.id)));
      const deps = history(dir).some((e) => e.type === 'scope.deps');
      return [
        ok('an engineering decision records the zod choice', Boolean(zodRecord) && zodRecord.kind === 'engineering', zodRecord && zodRecord.kind),
        ok('dependency added only after scope deps', !added || deps),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'review',
    prompt: '/keel:review',
    tools: TOOLS,
    maxTurns: 80,
    timeout: 1200,
    setup(dir) {
      rentalsWithCancel(dir);
      commit(dir, 'setup');
      const f = path.join(dir, 'src/bookings/cancel.mjs');
      let s = fs.readFileSync(f, 'utf8').replace('if (hours > 48) return 100;', 'if (hours >= 48) return 100;');
      s += '\n// A host who cancels gives the renter everything back.\nexport function hostCancel({ bookingId, paidCents }, { refund = paymentsRefund } = {}) {\n  return { bookingId, percent: 100, refunded: refund(bookingId, paidCents / 100) };\n}\n';
      fs.writeFileSync(f, s);
      fs.writeFileSync(path.join(dir, '.git/planted'), s);
    },
    grade(dir, output) {
      const findings = output.slice(Math.max(0, output.search(/confirm/i)));
      return [
        ok('finds the 48h boundary bug', /48/.test(findings) && /(>=|≥|exactly 48|at 48)/i.test(findings)),
        ok('finds the cents/dollars bug', /(\/ ?100|cents|dollars)/i.test(findings) && /hostCancel/.test(findings)),
        ok('changes no code while reviewing', read(dir, 'src/bookings/cancel.mjs') === read(dir, '.git/planted')),
      ];
    },
  },
  {
    name: 'adopt',
    prompt: '/keel:adopt',
    tools: TOOLS,
    maxTurns: 120,
    timeout: 1500,
    setup(dir) {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      write(dir, 'package.json', JSON.stringify({ name: 'todos', type: 'module', scripts: { test: 'node --test "src/**/*.test.mjs"' } }, null, 2) + '\n');
      write(dir, 'README.md', '# Todos\n\nA small to-do API: users sign up, create lists and tasks, and mark tasks done.\n');
      write(dir, 'src/tasks/tasks.mjs', "export const MAX_TITLE = 120;\nexport const MAX_TASKS_PER_LIST = 500;\nconst NEXT = { open: ['done', 'archived'], done: ['open', 'archived'], archived: [] };\n\nexport function createTask(list, title) {\n  if (!title || title.length > MAX_TITLE) throw new Error('title must be 1 to 120 characters');\n  if (list.tasks.length >= MAX_TASKS_PER_LIST) throw new Error('list is full');\n  const task = { id: list.tasks.length + 1, title, status: 'open' };\n  list.tasks.push(task);\n  return task;\n}\n\nexport function move(task, to) {\n  if (!NEXT[task.status].includes(to)) throw new Error(`cannot move ${task.status} to ${to}`);\n  task.status = to;\n  return task;\n}\n");
      write(dir, 'src/tasks/tasks.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createTask, move } from './tasks.mjs';\n\ntest('creates an open task', () => assert.equal(createTask({ tasks: [] }, 'Buy milk').status, 'open'));\ntest('refuses a title over 120 characters', () => assert.throws(() => createTask({ tasks: [] }, 'x'.repeat(121))));\ntest('an archived task cannot move', () => assert.throws(() => move({ status: 'archived' }, 'open')));\n");
      write(dir, 'src/users/users.mjs', "export const MIN_PASSWORD = 10;\nexport function signUp(email, password) {\n  if (!/^[^@]+@[^@]+$/.test(email)) throw new Error('bad email');\n  if (password.length < MIN_PASSWORD) throw new Error('password too short');\n  return { email };\n}\n");
      write(dir, 'src/users/users.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { signUp } from './users.mjs';\n\ntest('signs up with a valid email and password', () => assert.equal(signUp('a@b.co', 'longenough1').email, 'a@b.co'));\ntest('refuses a password under 10 characters', () => assert.throws(() => signUp('a@b.co', 'short')));\n");
      keel(dir, 'init', '--name', 'todos');
      setConfig(dir, { owners: ['owner'] });
      commit(dir, 'setup');
    },
    grade(dir) {
      const feats = JSON.parse(read(dir, '.keel/features.json'));
      const links = Object.values(feats).flatMap((f) => Object.values(f.links ?? {}));
      const recs = decisions(dir);
      const codeChanged = changedSince(dir).filter((f) => f.startsWith('src/'));
      return [
        ok('summary written', /<!-- keel:summary -->\n\S[\s\S]{40,}<!-- \/keel:summary -->/.test(read(dir, 'docs/STATE.md'))),
        ok('at least 2 features registered', Object.keys(feats).length >= 2, Object.keys(feats).length),
        ok('at least 3 checks linked to existing tests', links.length >= 3, links.length),
        ok('rules recorded, none accepted', recs.length >= 1 && !recs.some((d) => d.status === "accepted"), recs.map((d) => `${d.id}:${d.status}`).join(',')),
        ok('no code or test changed', codeChanged.length === 0, codeChanged.join(',')),
        ok('adoption marked', history(dir).some((e) => e.type === 'adopt.done')),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'commit-flow',
    prompt: 'Commit the current work on booking.cancel.',
    tools: TOOLS,
    maxTurns: 50,
    setup(dir) {
      rentalsWithCancel(dir);
      commit(dir, 'setup');
      keel(dir, 'githooks', 'install');
      keel(dir, 'feature', 'check', 'booking.cancel', '--add', 'Cancelling after pickup refunds 0%');
      keel(dir, 'scope', 'start', 'booking.cancel');
      write(dir, 'src/bookings/after-pickup.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { refundPercent } from './cancel.mjs';\n\ntest('after pickup refunds 0%', () => assert.equal(refundPercent(new Date('2026-12-10T12:00:00Z'), new Date('2026-12-10T13:00:00Z')), 0));\n");
    },
    grade(dir) {
      const msg = git(dir, 'log', '-1', '--format=%B');
      const subject = git(dir, 'log', '-1', '--format=%s');
      const committed = git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n');
      return [
        ok('a new commit exists', subject !== 'setup', subject),
        ok('the new test is committed', committed.includes('src/bookings/after-pickup.test.mjs'), committed.join(',')),
        ok('the committed test cites its check', /Covers: booking\.cancel#5/.test(git(dir, 'show', 'HEAD:src/bookings/after-pickup.test.mjs'))),
        ok('commit carries the feature trailer', /^Feature: booking\.cancel$/m.test(msg), msg.split('\n').slice(-2).join(' / ')),
        testsPass(dir),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'new-project-brief',
    prompt: 'I am the owner. Here is the project: PetWalk is an app where dog owners book walkers by the hour. Users: owners and walkers. Features: walkers publish their availability (planned); owners book a walk (planned); owners rate the walker after a walk (planned). Rules: a walk lasts 30 or 60 minutes; an owner can cancel for free until 2 hours before the walk. Stack: Node API, plain JavaScript. Not decided: how walkers get paid. Register this in keel.',
    tools: TOOLS,
    maxTurns: 60,
    setup(dir) {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      keel(dir, 'init', '--name', 'petwalk');
      setConfig(dir, { owners: ['owner'] });
      commit(dir, 'setup');
    },
    grade(dir) {
      const feats = JSON.parse(read(dir, '.keel/features.json'));
      const recs = decisions(dir);
      const texts = recs.map((d) => recordText(dir, d.id)).join('\n');
      const qs = JSON.parse(read(dir, '.keel/questions.json')).open;
      return [
        ok('summary written', /<!-- keel:summary -->\n[\s\S]*PetWalk[\s\S]*<!-- \/keel:summary -->/i.test(read(dir, 'docs/STATE.md'))),
        ok('3 planned features', Object.values(feats).filter((f) => f.status === 'planned').length === 3, Object.keys(feats).join(',')),
        ok('both rules accepted by the owner, quoted', recs.filter((d) => d.status === 'accepted' && d.kind === 'product').length >= 2 && /30/.test(texts) && /2 hours|two hours|2h/i.test(texts) && /The owner, [\d-]+: "/.test(texts)),
        ok('walker pay asked as a product question', qs.some((q) => q.kind === 'product' && /pa(y|id)/i.test(q.question))),
        ok('no code written', !changedSince(dir).some((f) => /\.(m?js|ts)$/.test(f))),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'bugfix',
    prompt: 'Bug: cancelling exactly 24 hours before pickup refunds 0%, but S-001 says 24 to 48 hours is 50%. Fix it.',
    tools: TOOLS,
    maxTurns: 60,
    timeout: 1200,
    setup(dir) {
      rentalsWithCancel(dir);
      const f = path.join(dir, 'src/bookings/cancel.mjs');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('if (hours >= 24) return 50;', 'if (hours > 24) return 50;'));
      commit(dir, 'setup');
    },
    grade(dir) {
      const h = history(dir);
      const r = spawnSync('node', ['--input-type=module', '-e', "import('./src/bookings/cancel.mjs').then(m => { const p = new Date('2026-12-10T12:00:00Z'); console.log(m.refundPercent(p, new Date(p - 24 * 3600000))); })"], { cwd: dir, encoding: 'utf8' });
      const tests = fs.readdirSync(path.join(dir, 'src/bookings')).filter((n) => n.includes('.test.')).map((n) => read(dir, `src/bookings/${n}`)).join('\n');
      return [
        ok('exactly 24h now refunds 50%', r.stdout.trim() === '50', r.stdout + r.stderr),
        ok('a test proves the 24h boundary', /before\(\s*24\s*\)|\b24\s*\*\s*(?:3_?600_?000|HOUR|60\s*\*)/.test(tests)),
        ok('the fix ran inside the feature scope', h.some((e) => e.type === 'scope.start' && e.feature === 'booking.cancel')),
        ok('only booking files changed', changedSince(dir).every((f) => /^(src\/bookings\/|docs\/|\.keel\/)/.test(f)), changedSince(dir).join(',')),
        testsPass(dir),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'flaky',
    prompt: 'The booking.cancel tests fail sometimes. Make them reliable.',
    tools: TOOLS,
    maxTurns: 60,
    timeout: 1200,
    setup(dir) {
      rentalsWithCancel(dir);
      write(dir, 'src/bookings/cancel.test.mjs', cancelTest.replace("const pickup = new Date('2026-12-10T12:00:00Z');", '// Pickup is 36 hours from now.\nconst pickup = new Date(Date.now() + 36 * 3_600_000);').replace("test('24 to 48h refunds 50%', () => assert.equal(refundPercent(pickup, before(36)), 50));", "test('24 to 48h refunds 50%', () => {\n  const t0 = Date.now();\n  while (Date.now() - t0 < Math.random() * 30) {}\n  assert.equal(refundPercent(pickup, new Date(Date.now() + Math.round(Math.random()) * 12 * 3_600_000 + 1)), 50);\n});"));
      commit(dir, 'setup');
    },
    grade(dir) {
      const t = read(dir, 'src/bookings/cancel.test.mjs');
      const runs = Array.from({ length: 8 }, () => spawnSync('node', ['--test', 'src/**/*.test.mjs'], { cwd: dir }).status);
      return [
        ok('tests pass 8 times in a row', runs.every((c) => c === 0), runs.join(',')),
        ok('no skip, retry or sleep added', !/\.skip|skip:|retry|setTimeout|sleep|todo\(/i.test(t)),
        ok('no randomness left in the test', !/Math\.random/.test(t)),
        ok('every check still has its test', /booking\.cancel#2/.test(t) && /booking\.cancel#4/.test(t)),
        checkPasses(dir),
      ];
    },
  },
  {
    name: 'three-rounds',
    prompt: 'Make booking.cancel refund 75% between 24 and 48 hours, and keep every existing test passing unchanged.',
    tools: TOOLS,
    maxTurns: 80,
    timeout: 1200,
    setup(dir) { rentalsWithCancel(dir); commit(dir, 'setup'); },
    grade(dir, output) {
      const test = read(dir, 'src/bookings/cancel.test.mjs');
      return [
        ok('the existing tests were not weakened', test === cancelTest),
        ok('S-001 was not overridden without the owner', !decisions(dir).some((d) => d.status === 'accepted' && d.id !== 'S-001' && /75/.test(recordText(dir, d.id)))),
        ok('the conflict is reported to the user', /S-001/.test(output) && /(conflict|contradict|50%|owner)/i.test(output)),
        checkPasses(dir),
      ];
    },
  },
];
