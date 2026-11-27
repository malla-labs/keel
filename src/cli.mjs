import fs from 'node:fs';
import path from 'node:path';
import { KeelError, fail } from './util.mjs';
import { findRoot, loadProject } from './config.mjs';
import { acceptDecision, loadDecisions, newDecision, nextId, renumberRecord } from './decisions.mjs';
import { writeCiWorkflow } from './ci.mjs';
import { addQuestion, answerQuestion, withdrawQuestion, formatQuestion, loadQuestions, renderOpenQuestions } from './questions.mjs';
import { addCheck, addFeature, builtProblems, getFeature, linkCheck, loadFeatures, setFeature } from './features.mjs';
import { allowDeps, clearScope, judge, loadScope, startScope, widenScope } from './scope.mjs';
import { baseline, check } from './check.mjs';
import { brief, renderState, writeSummary } from './state.mjs';
import { scan } from './scan.mjs';
import { addFeatureTrailer, hooksStatus, installHooks, installMergeSupport, mergeSupportStatus, uninstallHooks, uninstallMergeSupport } from './githooks.mjs';
import { runMergeDriver } from './team.mjs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init } from './init.mjs';
import { coverage, fingerprint, formatProgress, logEvent, markVerified, progress } from './progress.mjs';
import { addFinding, formatFinding, loadReviews, openFindings, resolveFinding } from './reviews.mjs';
import { formatVerify, runVerify, verifyRecord } from './verify.mjs';
import { architecturePath, formatModules, loadArchitecture, renderArchitecture, setModule } from './architecture.mjs';

const HELP = `keel: decisions, questions, features and guards for a project.

  keel version | --version         (the installed keel version)
  keel rules [rules|questions|briefing]   (print keel's working rules, the question pattern, the subagent brief)
  keel init [--name N] [--mode full|light] [--pattern P] [--owner NAME] [--session-owner]
  keel decision next <AREA>
  keel decision new --area A --title T --kind product|engineering --by WHO --decision TEXT
                    [--status proposed|accepted] [--quote TEXT] [--why TEXT] [--context TEXT]
                    [--consequences TEXT] [--alternatives TEXT] [--code TEXT] [--supersedes ID]
  keel decision accept <ID> --by WHO [--quote TEXT]
  keel decision list [--area A] [--status S]
  keel decision renumber <RECORD FILE> [--refs GLOBS]   (after a merge: give a record that collides a new number)
  keel question add --kind product|engineering --question Q --blocks WHY
                    --option TEXT --option '*RECOMMENDED' [--option ...] --default TEXT
                    [--feature F] [--decision ID]          (or: --json '<object>')
  keel question answer <Q> --answer A|TEXT --by WHO [--quote TEXT] [--decision ID] [--work TEXT]
  keel question withdraw <Q> --reason WHY --by WHO   (replaced by better questions, or no longer needed)
  keel question list [--kind K]
  keel feature add <ID> --title T [--status S] [--files GLOBS] [--risk low|normal|high]
  keel feature check <ID> --add TEXT [--test 'FILE::TEST NAME']   (--test links an existing test, no edit needed)
  keel feature check <ID> --link N --test 'FILE::TEST NAME'
  keel feature set <ID> [--status S] [--risk R] [--files GLOBS --reason WHY] [--decision IDS] [--remove-check N] [--done-work N]
  keel feature verified <ID> --command CMD [--evidence TEXT ...]   (record a passing verification; needs a test per check and a clean check)
  keel feature verified <ID> --run [--full]   (keel runs verify.quick|full, lint, types itself and records the result)
  keel feature verified --stale --command CMD | --run   (verify again every feature whose files changed after its verification)
  keel verify [--full]            (run verify.quick|full, verify.lint and verify.types; exit 1 on the first failure)
  keel feature list | show <ID>
  keel review add --feature F --severity important|nit|pre-existing --verdict confirmed|rejected --summary TEXT
                  [--where PATH:LINE] [--reason WHY]   (a finding from /keel:review, with the verifier's verdict)
  keel review resolve <R-n> --fixed WHAT | --answered WHY
  keel review list [--open] [--feature F]
  keel module add <NAME> --about TEXT --files GLOBS [--uses MODULES] --decision ID   (a part of the architecture)
  keel module set <NAME> [--about TEXT] [--files GLOBS] [--uses MODULES] --decision ID
  keel module list                (modules, their files and what each may import; docs/ARCHITECTURE.md is generated)
  keel progress [FEATURE] [--json]           (feature, scope and development progress)
  keel scope start <FEATURE> [--files GLOBS] [--take] | widen <GLOB> --reason WHY | deps <DECISION> | clear | show
  keel check [--changed] [--strict] [--json]
  keel baseline                   (adopting keel: record today's errors so only new ones fail)
  keel scan                       (facts about the repository: languages, manifests, test scripts, layout, docs)
  keel summary set --file F | --text T   (the project summary every session reads; at most 40 lines)
  keel ci github                  (write .github/workflows/keel.yml: keel check --strict and keel verify on every pull request)
  keel githooks install|uninstall|status   (git pre-commit, commit-msg, pre-push; never overwrites other hooks)
  keel adopted                    (mark the end of adopting a project: what existed is not counted as pace)
  keel render
  keel brief
  keel hook guard|brief|prompt|stop      (for Claude Code hooks; reads the event on stdin)
`;

const PROMPT_REMINDER = 'keel: if this message states a rule, a number, a decision or an answer, run /keel:decide (or /keel:answer) before building.';

/** The plugin's version, from its manifest. */
export function version() {
  return JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
}

/** Parses argv into positionals and options; repeated options become arrays. */
export function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq > -1 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let val;
      if (eq > -1) val = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i];
      else val = true;
      if (key in opts) opts[key] = [].concat(opts[key], val);
      else opts[key] = val;
    } else pos.push(a);
  }
  return { pos, opts };
}

function one(v, name) {
  if (Array.isArray(v)) fail(`--${name} was given more than once.`);
  return v === true ? undefined : v;
}

export async function main(argv, io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'), stdin: readStdin }) {
  if (argv[0] === '--version' || argv[0] === '-v') argv = ['version'];
  const { pos, opts } = parseArgs(argv);
  const [cmd, sub, ...rest] = pos;
  const json = (v) => io.out(JSON.stringify(v, null, 2));
  try {
    switch (cmd) {
      case undefined:
      case 'help':
        io.out(HELP);
        return 0;
      case 'version':
        io.out(version());
        return 0;
      case 'init':
        json(init(process.cwd(), { name: one(opts.name, 'name'), mode: one(opts.mode, 'mode'), pattern: one(opts.pattern, 'pattern'), sessionOwner: Boolean(opts.sessionOwner), owners: opts.owner ? [].concat(opts.owner) : undefined }));
        return 0;
      case 'hook':
        if (sub === 'git') return gitHook(rest[0], rest[1], io, rest.slice(2));
        return await hook(sub, io);
      case 'rules': {
        const names = { rules: 'rules.md', questions: 'question-pattern.md', briefing: 'briefing.md' };
        const file = names[sub ?? 'rules'];
        if (!file) fail(`Unknown rules "${sub}".`, `One of: ${Object.keys(names).join(', ')}.`);
        io.out(fs.readFileSync(new URL(`../references/${file}`, import.meta.url), 'utf8'));
        return 0;
      }
    }
    const project = loadProject();
    switch (cmd) {
      case 'decision': {
        if (sub === 'next') { io.out(nextId(project, String(rest[0] ?? '').toUpperCase())); return 0; }
        if (sub === 'new') {
          const o = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, one(v, k)]));
          const r = newDecision(project, o);
          logEvent(project, 'decision.new', { id: r.id, kind: r.kind, status: r.status, ...(r.superseded ? { supersedes: r.superseded } : {}) });
          renderState(project);
          json({ ...r, file: path.relative(project.root, r.file) });
          return 0;
        }
        if (sub === 'renumber') {
          const r = renumberRecord(project, rest[0], [].concat(opts.refs ?? []).flatMap((g) => String(g).split(',')).map((g) => g.trim()).filter(Boolean));
          logEvent(project, 'decision.renumber', r);
          renderState(project);
          json(r);
          return 0;
        }
        if (sub === 'accept') { json(acceptDecision(project, rest[0], one(opts.by, 'by'), one(opts.quote, 'quote'))); logEvent(project, 'decision.accept', { id: rest[0] }); renderState(project); return 0; }
        if (sub === 'list') {
          const area = one(opts.area, 'area');
          const status = one(opts.status, 'status');
          for (const r of loadDecisions(project)) {
            if (area && r.area !== area.toUpperCase()) continue;
            if (status && r.status !== status) continue;
            io.out(`${r.id}  ${(r.status ?? '?').padEnd(10)} ${(r.kind ?? '?').padEnd(11)} ${r.title}`);
          }
          return 0;
        }
        break;
      }
      case 'question': {
        if (sub === 'add') {
          const input = opts.json ? JSON.parse(one(opts.json, 'json')) : {
            kind: one(opts.kind, 'kind'), question: one(opts.question, 'question'), blocks: one(opts.blocks, 'blocks'),
            options: [].concat(opts.option ?? []), default: one(opts.default, 'default'),
            feature: one(opts.feature, 'feature'), decision: one(opts.decision, 'decision'),
          };
          const r = addQuestion(project, input);
          logEvent(project, 'question.add', { id: r.id, kind: r.kind, ...(input.feature ? { feature: input.feature } : {}) });
          renderState(project);
          json(r);
          return 0;
        }
        if (sub === 'answer') {
          const o = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, one(v, k)]));
          const r = answerQuestion(project, rest[0], o);
          logEvent(project, 'question.answer', { id: r.id, by: o.by });
          json(r);
          renderState(project);
          return 0;
        }
        if (sub === 'withdraw') {
          const r = withdrawQuestion(project, rest[0], { reason: one(opts.reason, 'reason'), by: one(opts.by, 'by') });
          logEvent(project, 'question.withdraw', { id: r.id });
          json(r);
          renderState(project);
          return 0;
        }
        if (sub === 'list') {
          const kind = one(opts.kind, 'kind');
          const qs = loadQuestions(project).open.filter((q) => !kind || q.kind === kind);
          io.out(qs.length ? qs.map(formatQuestion).join('\n') : 'No open questions.');
          return 0;
        }
        break;
      }
      case 'feature': {
        const id = rest[0];
        const evidence = [].concat(opts.evidence ?? []).filter((v) => v !== true).map((v) => String(v).trim()).filter(Boolean);
        const o = Object.fromEntries(Object.entries(opts).filter(([k]) => k !== 'evidence').map(([k, v]) => [k, one(v, k)]));
        if (sub === 'verified' && opts.run) {
          // keel runs the commands itself, so the record is evidence keel produced, not a claim.
          const ran = runVerify(project, { full: Boolean(opts.full) });
          io.err(formatVerify(ran));
          if (!ran.ok) fail('Verification failed; nothing recorded.');
          const rec = verifyRecord(ran);
          o.command = rec.command;
          evidence.push(...rec.evidence);
        }
        let r;
        if (sub === 'add') { r = addFeature(project, id, o); logEvent(project, 'feature.add', { feature: id, status: r.status, risk: o.risk ?? 'normal' }); }
        else if (sub === 'check') {
          if (o.link) { r = linkCheck(project, id, o.link, o.test); logEvent(project, 'feature.link', { feature: id, ref: r.ref, test: o.test }); }
          else { r = addCheck(project, id, o.add, o.test); logEvent(project, 'feature.check', { feature: id, ref: r.ref, ...(o.test ? { test: o.test } : {}) }); }
        }
        else if (sub === 'set') {
          const before = loadFeatures(project)[id]?.status;
          r = setFeature(project, id, { ...o, proof: (fid, f) => [...builtProblems(project, fid, f, { coverage, fingerprint }), ...findingProblems(project, fid)] });
          if (o.status && before !== r.status) logEvent(project, 'feature.status', { feature: id, from: before, to: r.status });
          if (r.filesAdded) logEvent(project, 'feature.files', { feature: id, added: r.filesAdded, ...(o.reason ? { reason: o.reason } : {}) });
        } else if (sub === 'verified' && opts.stale) {
          if (id) fail('--stale verifies every stale feature; do not name one.');
          const result = check(project);
          const stale = Object.entries(loadFeatures(project)).filter(([, f]) => f.verified && fingerprint(project, f) !== f.verified.fingerprint).map(([fid]) => fid);
          // Each feature is judged on its own, so one with a missing test does not hide which others were recorded.
          r = { verified: [], failed: [] };
          for (const fid of stale) {
            try { markVerified(project, fid, o.command, result, evidence); r.verified.push(fid); logEvent(project, 'feature.verified', { feature: fid, command: o.command, stale: true, ...(opts.run ? { ran: true } : {}) }); }
            catch (e) { if (!(e instanceof KeelError)) throw e; r.failed.push({ feature: fid, problem: e.message }); }
          }
          if (r.failed.length) { renderState(project); json(r); return 1; }
        } else if (sub === 'verified') {
          r = markVerified(project, id, o.command, check(project), evidence);
          logEvent(project, 'feature.verified', { feature: id, command: r.verified.command, ...(opts.run ? { ran: true } : {}), ...(evidence.length ? { evidence } : {}) });
        }
        else if (sub === 'show') { json({ id, ...getFeature(loadFeatures(project), id) }); return 0; }
        else if (sub === 'list') {
          for (const [fid, f] of Object.entries(loadFeatures(project))) io.out(`${fid.padEnd(28)} ${f.status.padEnd(9)} ${Object.keys(f.checks).length} checks  ${f.title}`);
          return 0;
        } else break;
        renderState(project);
        json(r);
        return 0;
      }
      case 'module': {
        const o = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, v === true ? true : one(v, k)]));
        if (sub === 'add' || sub === 'set') {
          const r = setModule(project, rest[0], o, { create: sub === 'add' });
          logEvent(project, `module.${sub}`, { module: r.module, files: r.files, uses: r.uses, decision: o.decision });
          json(r);
          return 0;
        }
        if (sub === 'list' || sub === undefined) { io.out(formatModules(loadArchitecture(project))); return 0; }
        break;
      }
      case 'ci': {
        if (sub !== 'github') fail('Use `keel ci github`.', 'Other CI systems: run `npx --yes github:malla-labs/keel check --strict` and `… verify` in a pull-request job.');
        json(writeCiWorkflow(project, version()));
        return 0;
      }
      case 'verify': {
        const ran = runVerify(project, { full: Boolean(opts.full) });
        io.out(formatVerify(ran));
        return ran.ok ? 0 : 1;
      }
      case 'review': {
        const o = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, one(v, k)]));
        if (sub === 'add') { const r = addFinding(project, o); logEvent(project, 'review.finding', { id: r.id, feature: o.feature, severity: o.severity, verdict: o.verdict }); renderState(project); json(r); return 0; }
        if (sub === 'resolve') { const r = resolveFinding(project, rest[0], o); logEvent(project, 'review.resolve', r); renderState(project); json(r); return 0; }
        if (sub === 'list' || sub === undefined) {
          const all = opts.open ? openFindings(project, o.feature) : loadReviews(project).findings.filter((f) => !o.feature || f.feature === o.feature);
          io.out(all.length ? all.map(formatFinding).join('\n') : 'No review findings.');
          return 0;
        }
        break;
      }
      case 'scope': {
        if (sub === 'start') { const r = startScope(project, rest[0], one(opts.files, 'files'), { take: Boolean(opts.take) }); logEvent(project, 'scope.start', { feature: r.feature, ...(opts.take ? { took: true } : {}) }); renderState(project); json(r); return 0; }
        if (sub === 'widen') { const r = widenScope(project, rest[0], one(opts.reason, 'reason')); logEvent(project, 'scope.widen', { feature: r.feature, glob: rest[0], reason: one(opts.reason, 'reason') }); json(r); return 0; }
        if (sub === 'deps') { const r = allowDeps(project, rest[0]); logEvent(project, 'scope.deps', { decision: rest[0] }); json(r); return 0; }
        if (sub === 'clear') { const had = loadScope(project); const r = clearScope(project); if (had) logEvent(project, 'scope.clear', { feature: had.feature }); renderState(project); json(r); return 0; }
        if (sub === 'show' || sub === undefined) { json(loadScope(project) ?? { active: false }); return 0; }
        break;
      }
      case 'check': {
        const r = check(project, { changed: Boolean(opts.changed), strict: Boolean(opts.strict) });
        if (opts.json) json(r);
        else io.out(formatCheck(r));
        return r.errors.length ? 1 : 0;
      }
      case 'baseline':
        json(baseline(project));
        return 0;
      case 'progress': {
        const p = progress(project);
        if (opts.json) json(sub ? { ...p, features: p.features.filter((f) => f.id === sub) } : p);
        else io.out(formatProgress(p, sub));
        return 0;
      }
      case 'scan':
        json(scan(project));
        return 0;
      case 'summary': {
        if (sub !== 'set') fail('Use `keel summary set --file <path>` or `--text <text>`.');
        const file = one(opts.file, 'file');
        const text = file ? fs.readFileSync(path.resolve(file), 'utf8') : one(opts.text, 'text');
        const r = writeSummary(project, text);
        logEvent(project, 'summary.set', r);
        json(r);
        return 0;
      }
      case 'githooks': {
        const cli = fileURLToPath(new URL('../bin/keel', import.meta.url));
        if (sub === 'install') {
          const generated = [path.relative(project.root, project.paths.state), path.relative(project.root, project.paths.openQuestions), path.relative(project.root, architecturePath(project))];
          const r = { ...installHooks(project.root, cli), merge: installMergeSupport(project.root, cli, generated) };
          logEvent(project, 'githooks.install', {});
          json(r);
          return 0;
        }
        if (sub === 'uninstall') { const r = uninstallHooks(project.root); uninstallMergeSupport(project.root); json(r); return 0; }
        if (sub === 'status' || sub === undefined) { json({ ...hooksStatus(project.root), 'merge-driver': mergeSupportStatus(project.root) }); return 0; }
        break;
      }
      case 'adopted':
        logEvent(project, 'adopt.done', {});
        io.out('Adoption recorded: the weekly pace counts from now.');
        return 0;
      case 'render':
        renderOpenQuestions(project);
        renderState(project);
        if (Object.keys(loadArchitecture(project).modules).length) renderArchitecture(project);
        io.out('Rendered.');
        return 0;
      case 'brief':
        io.out(brief(project));
        return 0;
    }
    fail(`Unknown command: ${[cmd, sub].filter(Boolean).join(' ')}`, 'Run `keel help`.');
  } catch (e) {
    if (e instanceof KeelError) {
      io.err(`keel: ${e.message}${e.hint ? `\n${e.hint}` : ''}`);
      return 1;
    }
    if (e instanceof SyntaxError) { io.err(`keel: invalid JSON: ${e.message}`); return 1; }
    throw e;
  }
}

/** Open important findings stand between a feature and "built", like a check without a test. */
function findingProblems(project, feature) {
  return openFindings(project, feature).filter((f) => f.severity === 'important')
    .map((f) => `open review finding R-${f.id}: ${f.summary} (fix it and run \`keel review resolve R-${f.id} --fixed "<what changed>"\`, or --answered "<why it stays>")`);
}

export function formatCheck(r) {
  const lines = [];
  for (const e of r.errors) lines.push(`ERROR ${e.where}: ${e.message}`);
  for (const w of r.warnings) lines.push(`WARN  ${w.where}: ${w.message}`);
  lines.push(`${r.errors.length ? 'FAIL' : 'OK'}: ${r.errors.length} errors, ${r.warnings.length} warnings${r.baselined ? `, ${r.baselined} baselined` : ''} (${r.scanned.code} code files, ${r.scanned.tests} test files).`);
  return lines.join('\n');
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/**
 * Claude Code hooks. They never crash a session: outside a keel project, or on bad input, they allow.
 * guard: PreToolUse. Exit 2 with a reason on stderr blocks the call.
 * brief: SessionStart. Prints the briefing as context.
 * stop:  Stop. Blocks the end of a turn once while `keel check --changed` fails.
 */
async function hook(kind, io) {
  let event = {};
  try { event = JSON.parse((await io.stdin()) || '{}'); } catch { return 0; }
  let root = findRoot(event.cwd || process.cwd());
  // A Bash command may `cd` into a project from elsewhere: look there too.
  const cd = event.tool_name === 'Bash' && /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/.exec(String(event.tool_input?.command ?? ''));
  if (!root && cd) root = findRoot(path.resolve(event.cwd || process.cwd(), cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~')));
  if (!root) return 0;
  let project;
  try { project = loadProject(root); } catch (e) { io.err(`keel: ${e.message}`); return 0; }
  if (kind === 'brief') { io.out(brief(project)); return 0; }
  if (kind === 'prompt') { io.out(PROMPT_REMINDER); return 0; }
  if (kind === 'guard') {
    const input = event.tool_input ?? {};
    let verdict;
    if (event.tool_name === 'Bash') verdict = judge(project, { command: String(input.command ?? ''), cwd: event.cwd || root });
    else {
      const file = input.file_path ?? input.notebook_path ?? input.path;
      if (!file) return 0;
      const abs = path.resolve(event.cwd || root, file);
      verdict = judge(project, { rel: path.relative(root, abs).split(path.sep).join('/'), content: contentAfter(event.tool_name, input, abs) });
    }
    if (verdict.allow) return 0;
    io.err(`keel guard: ${verdict.reason}`);
    return 2;
  }
  if (kind === 'stop') {
    if (event.stop_hook_active) return 0;
    const { cfg } = project;
    if (cfg.mode === 'light' || cfg.gate === 'off') return 0;
    const r = check(project, { changed: true });
    if (!r.errors.length) return 0;
    const report = formatCheck(r);
    if (cfg.gate === 'observe') { gateLog(project, event, report); return 0; }
    const blocks = gateCount(project, event.session_id);
    if (blocks >= cfg.gateMaxBlocks) {
      io.out(`keel gate: let through after ${blocks} blocks this session. Tell the user plainly which checks still fail:\n${report}`);
      return 0;
    }
    gateCount(project, event.session_id, blocks + 1);
    io.err(`keel check failed on the changed files (block ${blocks + 1} of ${cfg.gateMaxBlocks}). Fix these before finishing, or tell the user why you cannot:\n${report}`);
    return 2;
  }
  if (kind === 'guard-log') return 0;
  return 0;
}

/**
 * Git hooks. pre-commit: `check --changed`. commit-msg: adds the active feature as a trailer.
 * pre-push: the full `check`, then `verify.quick`. `gate` decides: enforce blocks, observe prints, off skips.
 * Outside a keel project they do nothing.
 */
function gitHook(kind, arg, io, extra = []) {
  if (kind === 'merge-driver') {
    // git runs it from the top of the work tree: %P is the path, then %O %A %B. Writes the merge into %A.
    const renumbered = runMergeDriver(arg, ...extra);
    for (const r of renumbered) io.err(`keel merge: ${arg}: their ${String(r.from).includes('#') ? r.from : `#${r.from}`} became ${String(r.to).includes('#') ? r.to : `#${r.to}`} (the number was taken on this branch). Update any reference to it.`);
    return 0;
  }
  const root = findRoot(process.cwd());
  if (!root) return 0;
  const project = loadProject(root);
  const { cfg } = project;
  if (kind === 'post-merge') {
    // Generated files kept "ours" during the merge are rewritten from the merged records.
    renderOpenQuestions(project);
    renderState(project);
    if (Object.keys(loadArchitecture(project).modules).length) renderArchitecture(project);
    const dup = check(project).errors.filter((e) => /is also used by/.test(e.message));
    for (const d of dup) io.err(`keel post-merge: ${d.where}: ${d.message}. Renumber the record that came from the merged branch: \`keel decision renumber <its file> --refs "<globs of files citing it>"\`.`);
    return 0;
  }
  if (kind === 'commit-msg') {
    const scope = loadScope(project);
    if (scope?.feature && addFeatureTrailer(arg, scope.feature)) io.err(`keel: added "Feature: ${scope.feature}" to the commit message.`);
    return 0;
  }
  if (cfg.mode === 'light' || cfg.gate === 'off') return 0;
  const block = cfg.gate === 'enforce';
  const r = check(project, { changed: kind === 'pre-commit' });
  if (r.errors.length) {
    io.err(`keel ${kind}: ${block ? 'blocked' : 'would block (observe)'}.\n${formatCheck(r)}\nFix these, or commit with --no-verify and say why in the message.`);
    if (block) return 1;
  }
  if (kind === 'pre-push' && cfg.verify?.quick) {
    try {
      execSync(cfg.verify.quick, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    } catch {
      io.err(`keel pre-push: ${block ? 'blocked' : 'would block (observe)'}: verify.quick failed (${cfg.verify.quick}).`);
      if (block) return 1;
    }
  }
  return 0;
}

/** The file's text after a Write or Edit, when it can be known before the tool runs. */
function contentAfter(tool, input, abs) {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : undefined;
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return undefined; }
  const edits = tool === 'Edit' ? [input] : tool === 'MultiEdit' ? input.edits ?? [] : null;
  if (!edits) return undefined;
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || !text.includes(e.old_string)) return undefined;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  }
  return text;
}

function gateFile(project) {
  return path.join(project.paths.keel, '.gate.json');
}

/** Reads, or with `set` writes, how many times the stop gate blocked in one session. */
function gateCount(project, sessionId = 'unknown', set) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(gateFile(project), 'utf8')); } catch {}
  if (set === undefined) return state[sessionId] ?? 0;
  const keys = Object.keys(state);
  if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete state[k];
  state[sessionId] = set;
  fs.writeFileSync(gateFile(project), JSON.stringify(state));
  return set;
}

function gateLog(project, event, report) {
  fs.appendFileSync(path.join(project.paths.keel, 'gate.log'), `--- ${new Date().toISOString()} session ${event.session_id ?? '?'} (observe: would have blocked)\n${report}\n`);
}

export function isMain(metaUrl) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(metaUrl).pathname); } catch { return false; }
}
