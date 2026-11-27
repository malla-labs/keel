import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { citedDecisions, citedQuestions, gitChanged, matchesAny, readJSON, walk, writeJSON } from './util.mjs';
import { indexDecisions, loadDecisions } from './decisions.mjs';
import { loadQuestions, questionProblems, renderOpenQuestionsText } from './questions.mjs';
import { featureProblems, linkProblem, loadFeatures } from './features.mjs';
import { renderStateText } from './state.mjs';

const COVERS_RE = /\bCovers:\s*([^\n*]+)/g;
const REF_RE = /[A-Z]-\d+|[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*#\d+/g;
const CASE_RES = [
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|each\([^)]*\)))?\s*\(/,
  /^\s*@Test\b/,
  /^\s*func\s+test\w*\s*\(/,
  /^\s*@Test\s*(?:\(|func)/,
  /^\s*def\s+test_\w*\s*\(/,
  /^\s*func\s+Test\w*\s*\(\s*t\s+\*testing\.T/,
];

/**
 * Checks the whole project. With `changed`, code and tests are checked only in files git reports as changed.
 * Returns { errors: [{where, message}], warnings: [...] }.
 */
export function check(project, { changed = false, strict = false } = {}) {
  const { cfg, paths, root } = project;
  const errors = [];
  const warnings = [];
  const err = (where, message, context = '') => errors.push({ where, message, key: baselineKey(where, message, context) });
  const warn = (where, message) => (strict ? errors : warnings).push({ where, message });
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');

  // Decision records.
  const records = loadDecisions(project);
  const byId = indexDecisions(records);
  const seen = new Map();
  for (const r of records) {
    for (const p of r.problems) err(rel(r.file), p);
    if (!r.id) continue;
    if (seen.has(r.id)) err(rel(r.file), `id ${r.id} is also used by ${seen.get(r.id)}`);
    seen.set(r.id, rel(r.file));
    if (!r.legacy) {
      if (!r.hasStatusLine) err(rel(r.file), 'missing "Status:" line under the title');
      if (!r.hasKindLine) err(rel(r.file), 'missing "Kind:" line under the title');
    }
    if (r.status === 'superseded') {
      const n = byId.get(r.supersededBy);
      if (!n) err(rel(r.file), `superseded by ${r.supersededBy}, which does not exist`);
      else if (!fs.readFileSync(n.file, 'utf8').includes(r.id)) err(rel(n.file), `supersedes ${r.id} but never names it`);
    }
  }

  // Questions.
  const store = loadQuestions(project);
  for (const q of store.open) {
    for (const p of questionProblems(q, project, { wording: false })) err(`Q-${q.id}`, p);
    if (q.id > store.lastId) err(`Q-${q.id}`, `number is above lastId ${store.lastId}`);
  }
  const ids = store.open.map((q) => q.id);
  if (new Set(ids).size !== ids.length) err('.keel/questions.json', 'two open questions share a number');
  if (fs.existsSync(paths.questions) && (!fs.existsSync(paths.openQuestions) || fs.readFileSync(paths.openQuestions, 'utf8') !== renderOpenQuestionsText(project))) {
    err(rel(paths.openQuestions), 'is out of date with .keel/questions.json: run `keel render`');
  }

  // Features.
  const features = loadFeatures(project);
  for (const p of featureProblems(features)) err('.keel/features.json', p);
  for (const [fid, f] of Object.entries(features)) {
    for (const d of f.decisions ?? []) if (!byId.has(d)) err(`.keel/features.json ${fid}`, `cites decision ${d}, which does not exist`);
    for (const [n, link] of Object.entries(f.links ?? {})) {
      if (!f.checks?.[n]) err(`.keel/features.json ${fid}#${n}`, 'links a test to a check that does not exist');
      const p = linkProblem(project, link);
      if (p) err(`.keel/features.json ${fid}#${n}`, `linked test is gone: ${p}`);
    }
  }

  // State file block: generated, so it is refreshed here rather than reported (its progress follows the tests).
  let refreshed = false;
  if (fs.existsSync(paths.state)) {
    const text = fs.readFileSync(paths.state, 'utf8');
    if (text.includes('<!-- keel:state -->')) {
      const next = renderStateText(project, text);
      if (next !== text) { fs.writeFileSync(paths.state, next); refreshed = true; }
    }
  }

  // A question named in code is a placeholder for an answer. Once answered, the code should cite the decision.
  const openIds = new Set(store.open.map((q) => q.id));
  const closedBy = new Map((store.closed ?? []).map((c) => [c.id, c]));

  // Code and tests.
  let files = walk(root, cfg.ignore);
  if (changed) {
    const c = gitChanged(root);
    if (c) files = files.filter((f) => c.includes(f));
  }
  const testFiles = files.filter((f) => matchesAny(f, cfg.tests.files));
  const codeFiles = files.filter((f) => matchesAny(f, cfg.code) && !testFiles.includes(f));
  const covered = new Map();

  for (const f of codeFiles) {
    const lines = readLines(root, f);
    lines.forEach((line, i) => {
      for (const id of citedDecisions(line)) citeProblem(id, `${f}:${i + 1}`);
      for (const n of citedQuestions(line)) questionRefProblem(n, `${f}:${i + 1}`);
    });
  }

  function citeProblem(id, where) {
    const r = byId.get(id);
    if (!r) return err(where, `cites ${id}, which does not exist`);
    if (r.status === 'proposed' && r.kind === 'product') err(where, `cites ${id}, a product rule the owner has not accepted`);
    if (r.status === 'superseded') warn(where, `cites ${id}, superseded by ${r.supersededBy}`);
  }

  function questionRefProblem(n, where) {
    if (openIds.has(n)) return;
    if (n > store.lastId) return err(where, `names Q-${n}, which does not exist`);
    const c = closedBy.get(n);
    const settled = c?.decision ? `; cite ${c.decision} instead` : c?.withdrawn ? ' (withdrawn); remove the reference' : '; cite the decision that settled it instead';
    warn(where, `names Q-${n}, which is no longer open${settled}`);
  }

  function refProblem(ref, where) {
    if (/^[A-Z]-\d+$/.test(ref)) return citeProblem(ref, where);
    const [fid, n] = ref.split('#');
    const feat = features[fid];
    if (!feat) return err(where, `covers ${ref}: no feature "${fid}"`);
    if (!feat.checks?.[n]) return err(where, `covers ${ref}: ${fid} has no check #${n}`);
    covered.set(ref, [...(covered.get(ref) ?? []), where]);
  }

  for (const f of testFiles) {
    const lines = readLines(root, f);
    for (const [i, line] of lines.entries()) {
      for (const m of line.matchAll(COVERS_RE)) for (const ref of m[1].match(REF_RE) ?? []) refProblem(ref, `${f}:${i + 1}`);
    }
    if (cfg.tests.require === 'off') continue;
    if (cfg.tests.require === 'file') {
      if (!lines.some((l) => /\bCovers:/.test(l))) err(f, 'test file cites nothing: add `Covers: <decision id or feature#check>`');
      continue;
    }
    for (const [i, line] of lines.entries()) {
      if (!CASE_RES.some((re) => re.test(line))) continue;
      const window = lines.slice(Math.max(0, i - 3), i + 2).join('\n');
      if (!/\bCovers:/.test(window)) err(`${f}:${i + 1}`, 'test cites nothing: put `Covers: <decision id or feature#check>` in its name or in a comment just above it', line.trim());
    }
  }

  for (const [fid, f] of Object.entries(features)) {
    for (const [n, link] of Object.entries(f.links ?? {})) if (!linkProblem(project, link)) covered.set(`${fid}#${n}`, [...(covered.get(`${fid}#${n}`) ?? []), link]);
  }

  if (!changed) {
    for (const [fid, f] of Object.entries(features)) {
      if (!['built', 'building'].includes(f.status)) continue;
      for (const n of Object.keys(f.checks ?? {})) {
        const ref = `${fid}#${n}`;
        const hits = covered.get(ref) ?? [];
        if (!hits.length) warn(`.keel/features.json ${ref}`, `no test covers this check ("${f.checks[n]}")`);
        if (hits.length > 1) warn(`.keel/features.json ${ref}`, `${hits.length} tests cover this check; one is enough (${hits.join(', ')})`);
      }
    }
  }

  const budget = baselineBudget(readJSON(paths.baseline, { files: {} }));
  const kept = errors.filter((e) => {
    const n = budget.get(e.key) ?? 0;
    if (n > 0) { budget.set(e.key, n - 1); return false; }
    return true;
  });
  return { errors: kept, warnings, refreshed, baselined: errors.length - kept.length, scanned: { code: codeFiles.length, tests: testFiles.length } };
}

/** A key that survives line moves: the file, plus a short hash of the message and the offending line's text. */
function baselineKey(where, message, context) {
  const file = where.replace(/:\d+$/, '');
  return `${file}|${createHash('sha1').update(`${message}|${context}`).digest('hex').slice(0, 10)}`;
}

function baselineBudget(store) {
  const budget = new Map();
  for (const [file, hashes] of Object.entries(store.files ?? {})) for (const [h, n] of Object.entries(hashes)) budget.set(`${file}|${h}`, n);
  return budget;
}

/** Records today's errors so only new ones fail. For adopting keel in an existing project. */
export function baseline(project) {
  writeJSON(project.paths.baseline, { files: {} });
  const r = check(project);
  const files = {};
  for (const e of r.errors) {
    const i = e.key.lastIndexOf('|');
    const file = e.key.slice(0, i);
    const h = e.key.slice(i + 1);
    files[file] ??= {};
    files[file][h] = (files[file][h] ?? 0) + 1;
  }
  writeJSON(project.paths.baseline, { note: 'Errors that existed when keel was adopted. Fix them over time; never edit by hand: run `keel baseline` to shrink it.', files });
  return { baselined: r.errors.length, files: Object.keys(files).length };
}

function readLines(root, f) {
  try {
    const buf = fs.readFileSync(path.join(root, f));
    if (buf.length > 2_000_000 || buf.includes(0)) return [];
    return buf.toString('utf8').split('\n');
  } catch {
    return [];
  }
}
