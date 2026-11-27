import fs from 'node:fs';
import path from 'node:path';
import { loadDecisions } from './decisions.mjs';
import { citedDecisions, fail, matchesAny as matchesGlobs, readJSON, today, walk as walkFiles, writeJSON } from './util.mjs';

export const STATUSES = ['planned', 'building', 'built', 'mocked', 'dropped'];
// How much review a feature's changes get: low (correctness), normal (+ rules, quality), high (+ security, regressions).
export const RISKS = ['low', 'normal', 'high'];
const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

export function loadFeatures(project) {
  return readJSON(project.paths.features, {});
}

export function saveFeatures(project, features) {
  const sorted = Object.fromEntries(Object.keys(features).sort().map((k) => [k, features[k]]));
  writeJSON(project.paths.features, sorted);
}

export function getFeature(features, id) {
  const f = features[id];
  if (!f) fail(`No feature "${id}".`, `Known: ${Object.keys(features).join(', ') || 'none'}. Add one with \`keel feature add\`.`);
  return f;
}

export function addFeature(project, id, opts) {
  if (!ID_RE.test(id)) fail(`Feature id "${id}" must be lowercase words joined by dots, such as booking.cancel.`);
  const features = loadFeatures(project);
  if (features[id]) fail(`Feature "${id}" already exists.`);
  const title = String(opts.title ?? '').trim();
  if (!title) fail('--title is required.');
  const status = opts.status ?? 'planned';
  if (!STATUSES.includes(status)) fail(`--status must be one of ${STATUSES.join(', ')}.`);
  const risk = opts.risk ?? 'normal';
  if (!RISKS.includes(risk)) fail(`--risk must be one of ${RISKS.join(', ')}.`);
  features[id] = { title, status, risk, decisions: [], checks: {}, lastCheck: 0, files: list(opts.files), work: [], added: today() };
  saveFeatures(project, features);
  return { id, status };
}

/**
 * Validates a link to an existing test, "path::name": the file exists and contains the name.
 * Returns null when valid, else the problem.
 */
export function linkProblem(project, link) {
  const m = /^(.+?)::(.+)$/.exec(String(link ?? '').trim());
  if (!m) return `"${link}" must be "<test file path>::<test name as written in the file>"`;
  const file = path.join(project.root, m[1]);
  if (!fs.existsSync(file)) return `test file ${m[1]} does not exist`;
  if (!fs.readFileSync(file, 'utf8').includes(m[2])) return `${m[1]} has no test named "${m[2]}"`;
  return null;
}

/** Links an existing test to a check without editing the test (for adopting a project). */
export function linkCheck(project, id, n, test) {
  const features = loadFeatures(project);
  const f = getFeature(features, id);
  if (!f.checks[String(n)]) fail(`${id} has no check #${n}.`);
  const p = linkProblem(project, test);
  if (p) fail(p);
  f.links = { ...(f.links ?? {}), [String(n)]: String(test).trim() };
  saveFeatures(project, features);
  return { ref: `${id}#${n}`, test };
}

/** Adds a check: one behaviour, which gets exactly one test. Numbers are never reused. */
export function addCheck(project, id, text, test) {
  const features = loadFeatures(project);
  const f = getFeature(features, id);
  const t = String(text ?? '').trim();
  if (t.length < 8) fail('A check must state one behaviour in a sentence.');
  if (Object.values(f.checks).some((c) => c.toLowerCase() === t.toLowerCase())) fail('That check already exists.');
  if (test) { const p = linkProblem(project, test); if (p) fail(p); }
  f.lastCheck = (f.lastCheck ?? Object.keys(f.checks).length) + 1;
  f.checks[String(f.lastCheck)] = t;
  if (test) f.links = { ...(f.links ?? {}), [String(f.lastCheck)]: String(test).trim() };
  saveFeatures(project, features);
  return { ref: `${id}#${f.lastCheck}`, ...(test ? { test } : {}) };
}

export function setFeature(project, id, opts) {
  const features = loadFeatures(project);
  const f = getFeature(features, id);
  if (opts.status) {
    if (!STATUSES.includes(opts.status)) fail(`--status must be one of ${STATUSES.join(', ')}.`);
    if (opts.status === 'built' && f.status !== 'built' && opts.proof) {
      const missing = opts.proof(id, f);
      if (missing.length) fail(`${id} cannot be built yet:\n- ${missing.join('\n- ')}`, 'Built means proven: every check has a test, the verification is current (`keel feature verified`), and the code cites each decision.');
    }
    f.status = opts.status;
  }
  if (opts.title) f.title = String(opts.title).trim();
  if (opts.risk) {
    if (!RISKS.includes(opts.risk)) fail(`--risk must be one of ${RISKS.join(', ')}.`);
    f.risk = opts.risk;
  }
  if (opts.files) {
    const added = list(opts.files).filter((g) => !(f.files ?? []).includes(g));
    if (added.length && (f.files ?? []).length && !String(opts.reason ?? '').trim()) {
      fail(`Adding ${added.join(', ')} to ${id}'s files needs --reason: the feature will own them from now on.`, 'If the work only needs to touch them once, use `keel scope widen <glob> --reason <why>` instead.');
    }
    f.files = [...new Set([...(f.files ?? []), ...added])];
    f.filesAdded = added;
  }
  if (opts.decision) for (const d of list(opts.decision)) if (!f.decisions.includes(d)) f.decisions.push(d);
  if (opts.removeCheck) {
    const n = String(opts.removeCheck);
    if (!f.checks[n]) fail(`${id} has no check #${n}.`);
    delete f.checks[n];
  }
  if (opts.doneWork != null) {
    const n = Number(opts.doneWork);
    if (!f.work?.[n - 1]) fail(`${id} has no work item ${n}.`);
    f.work.splice(n - 1, 1);
  }
  const added = f.filesAdded ?? [];
  delete f.filesAdded;
  saveFeatures(project, features);
  return { id, status: f.status, ...(added.length ? { filesAdded: added } : {}) };
}

export function list(v) {
  if (v == null || v === true) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
}

export function featureProblems(features) {
  const p = [];
  for (const [id, f] of Object.entries(features)) {
    if (!ID_RE.test(id)) p.push(`${id}: id must be lowercase words joined by dots`);
    if (!STATUSES.includes(f.status)) p.push(`${id}: status "${f.status}" is not one of ${STATUSES.join(', ')}`);
    if (!f.title) p.push(`${id}: no title`);
    if (!f.checks || typeof f.checks !== 'object') p.push(`${id}: checks must be an object`);
    if (!Array.isArray(f.decisions)) p.push(`${id}: decisions must be a list`);
    if (f.risk != null && !RISKS.includes(f.risk)) p.push(`${id}: risk "${f.risk}" is not one of ${RISKS.join(', ')}`);
  }
  return p;
}

/** What still stands between a feature and "built". Empty when it is proven. */
export function builtProblems(project, id, f, { coverage, fingerprint }) {
  const p = [];
  const checks = Object.keys(f.checks ?? {});
  if (!checks.length) p.push('it has no checks');
  const cov = coverage(project);
  const untested = checks.filter((n) => !cov.has(`${id}#${n}`));
  if (untested.length) p.push(`checks without a test: ${untested.map((n) => '#' + n).join(', ')}`);
  if (!f.verified) p.push('no verification recorded: run the verify command, then `keel feature verified ' + id + ' --command "<it>"`');
  else if (fingerprint(project, f) !== f.verified.fingerprint) p.push('the verification is stale: files changed after it; verify again');
  // A superseded record is cited through the record that replaced it, which the feature links too.
  const superseded = new Set(loadDecisions(project).filter((r) => r.status === 'superseded').map((r) => r.id));
  const decisions = (f.decisions ?? []).filter((d) => !superseded.has(d));
  if (decisions.length && f.files?.length) {
    const cited = new Set(walkFeatureCode(project, f).flatMap(citedDecisions));
    const uncited = decisions.filter((d) => !cited.has(d));
    if (uncited.length) p.push(`decisions not cited in the feature's code: ${uncited.join(', ')} (add \`// Decision: <ID>\` where the rule is implemented)`);
  }
  return p;
}

function walkFeatureCode(project, f) {
  const { cfg, root } = project;
  const out = [];
  for (const rel of walkFiles(root, cfg.ignore)) {
    if (!matchesGlobs(rel, f.files) || !matchesGlobs(rel, cfg.code) || matchesGlobs(rel, cfg.tests.files)) continue;
    try { out.push(fs.readFileSync(path.join(root, rel), 'utf8')); } catch {}
  }
  return out;
}
