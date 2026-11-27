import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fail, gitChanged, matchesAny, today, walk, writeJSON } from './util.mjs';
import { loadFeatures, saveFeatures, getFeature, linkProblem, STATUSES } from './features.mjs';
import { loadQuestions } from './questions.mjs';
import { indexDecisions, loadDecisions } from './decisions.mjs';
import { loadScope } from './scope.mjs';
import { openFindings } from './reviews.mjs';

const COVERS_RE = /\bCovers:\s*([^\n*]+)/g;
const CHECK_REF_RE = /[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*#\d+/g;

function now() {
  return process.env.KEEL_TODAY ? `${process.env.KEEL_TODAY}T00:00:00Z` : new Date().toISOString();
}

/** Appends one event to .keel/history.jsonl. The log is append-only and written by the CLI. */
export function logEvent(project, type, data = {}) {
  fs.mkdirSync(project.paths.keel, { recursive: true });
  fs.appendFileSync(historyFile(project), JSON.stringify({ at: now(), type, ...data }) + '\n');
}

export function historyFile(project) {
  return path.join(project.paths.keel, 'history.jsonl');
}

export function readHistory(project) {
  const f = historyFile(project);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/** Maps every `feature#n` cited by a test to the test files citing it. */
export function coverage(project) {
  const { cfg, root } = project;
  const cov = new Map();
  for (const f of walk(root, cfg.ignore).filter((x) => matchesAny(x, cfg.tests.files))) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(COVERS_RE)) {
      for (const ref of m[1].match(CHECK_REF_RE) ?? []) cov.set(ref, [...new Set([...(cov.get(ref) ?? []), f])]);
    }
  }
  for (const [fid, f] of Object.entries(loadFeatures(project))) {
    for (const [n, link] of Object.entries(f.links ?? {})) {
      if (!linkProblem(project, link)) cov.set(`${fid}#${n}`, [...new Set([...(cov.get(`${fid}#${n}`) ?? []), link.split('::')[0]])]);
    }
  }
  return cov;
}

/** A hash of the contents of every file the feature owns: it changes when any of them changes. */
export function fingerprint(project, f) {
  const globs = f.files ?? [];
  if (!globs.length) return null;
  const h = createHash('sha1');
  for (const rel of walk(project.root, project.cfg.ignore).filter((x) => matchesAny(x, globs))) {
    h.update(rel + '\0');
    try { h.update(fs.readFileSync(path.join(project.root, rel))); } catch {}
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Records that the feature was verified: allowed only when every check has a test and
 * `keel check` passes. Stores the command run and a fingerprint of the feature's files.
 */
export function markVerified(project, id, command, checkResult, evidence = []) {
  const features = loadFeatures(project);
  const f = getFeature(features, id);
  const cmd = String(command ?? '').trim();
  if (!cmd) fail('--command is required: the verify command that passed.');
  if (checkResult.errors.length) fail(`keel check has ${checkResult.errors.length} errors; fix them before recording a verification.`);
  const n = Object.keys(f.checks ?? {});
  if (!n.length) fail(`${id} has no checks; nothing to verify.`);
  const cov = coverage(project);
  const missing = n.filter((k) => !cov.has(`${id}#${k}`));
  if (missing.length) fail(`${id} checks without a test: ${missing.map((k) => `#${k}`).join(', ')}. Every check needs its test before the feature is verified.`);
  // Evidence is what the command alone does not show: a screenshot path, a manual run in a browser, a log.
  f.verified = { at: now(), command: cmd, fingerprint: fingerprint(project, f), ...(evidence.length ? { evidence } : {}) };
  saveFeatures(project, features);
  return { id, verified: f.verified };
}

export function featureProgress(project, id, f, cov, questions, byId) {
  const checks = Object.keys(f.checks ?? {});
  const covered = checks.filter((n) => cov.has(`${id}#${n}`));
  let verified = 'no';
  if (f.verified) verified = fingerprint(project, f) === f.verified.fingerprint ? 'yes' : 'stale';
  return {
    id,
    title: f.title,
    status: f.status,
    checks: checks.length,
    covered: covered.length,
    uncovered: checks.filter((n) => !covered.includes(n)).map((n) => `#${n} ${f.checks[n]}`),
    // 80 for checks with a test, 10 for a verification still current, 10 for being built.
    percent: (checks.length ? Math.round((covered.length / checks.length) * 80) : 0) + (verified === 'yes' ? 10 : 0) + (f.status === 'built' ? 10 : 0),
    verified,
    verifiedAt: f.verified?.at ?? null,
    work: (f.work ?? []).length,
    questions: questions.filter((q) => q.feature === id).map((q) => `Q-${q.id}`),
    proposed: (f.decisions ?? []).filter((d) => byId.get(d)?.status === 'proposed'),
    findings: openFindings(project, id).map((x) => `R-${x.id}`),
  };
}

export function progress(project) {
  const features = loadFeatures(project);
  const cov = coverage(project);
  const questions = loadQuestions(project).open;
  const byId = indexDecisions(loadDecisions(project));
  const list = Object.entries(features)
    .filter(([, f]) => f.status !== 'dropped')
    .map(([id, f]) => featureProgress(project, id, f, cov, questions, byId));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, Object.values(features).filter((f) => f.status === s).length]));
  const totalChecks = list.reduce((a, f) => a + f.checks, 0);
  const coveredChecks = list.reduce((a, f) => a + f.covered, 0);
  const overall = list.length ? Math.round(list.reduce((a, f) => a + f.percent, 0) / list.length) : 0;
  const history = readHistory(project);
  return {
    overall,
    counts,
    checks: { total: totalChecks, covered: coveredChecks },
    features: list,
    scope: scopeProgress(project, history),
    weekly: weekly(history),
    recent: history.slice(-8).reverse(),
  };
}

function scopeProgress(project, history) {
  const scope = loadScope(project);
  if (!scope?.feature) return null;
  const changed = gitChanged(project.root);
  const inScope = changed ? changed.filter((f) => matchesAny(f, scope.files)) : null;
  const start = [...history].reverse().find((e) => e.type === 'scope.start' && e.feature === scope.feature);
  return {
    feature: scope.feature,
    started: start?.at ?? scope.started,
    files: scope.files,
    widened: scope.widened.length,
    changedInScope: inScope,
  };
}

/** Features built and checks added per ISO week, from the history log. */
function weekly(history) {
  const weeks = new Map();
  // What existed before adoption is not this project's pace: count only after the last adopt.done.
  let start = 0;
  history.forEach((e, i) => { if (e.type === 'adopt.done') start = i + 1; });
  for (const e of history.slice(start)) {
    const w = isoWeek(e.at);
    const row = weeks.get(w) ?? { week: w, built: 0, checks: 0, decisions: 0, answered: 0 };
    if (e.type === 'feature.status' && e.to === 'built') row.built++;
    if (e.type === 'feature.check') row.checks++;
    if (e.type === 'decision.new') row.decisions++;
    if (e.type === 'question.answer') row.answered++;
    weeks.set(w, row);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-6);
}

function isoWeek(at) {
  const d = new Date(String(at).slice(0, 10) + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function bar(percent, width = 10) {
  const full = Math.round((percent / 100) * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

export function formatProgress(p, onlyId) {
  const out = [];
  const list = onlyId ? p.features.filter((f) => f.id === onlyId) : p.features;
  if (onlyId && !list.length) fail(`No feature "${onlyId}".`);
  if (!onlyId) {
    out.push(`Overall ${bar(p.overall)} ${p.overall}%  ·  checks with a test ${p.checks.covered}/${p.checks.total}`);
    out.push(`Features: ${STATUSES.filter((s) => p.counts[s]).map((s) => `${p.counts[s]} ${s}`).join(', ') || 'none'}`);
    out.push('');
  }
  for (const f of list) {
    const flags = [
      f.verified === 'yes' ? 'verified' : f.verified === 'stale' ? 'verified, now stale' : null,
      f.work ? `${f.work} work` : null,
      f.questions.length ? `waits on ${f.questions.join(', ')}` : null,
      f.proposed.length ? `proposed ${f.proposed.join(', ')}` : null,
      f.findings?.length ? `open findings ${f.findings.join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    out.push(`${f.id.padEnd(26)} ${f.status.padEnd(8)} ${bar(f.percent)} ${String(f.percent).padStart(3)}%  ${f.covered}/${f.checks} checks${flags ? '  · ' + flags : ''}`);
    if (onlyId) for (const u of f.uncovered) out.push(`  no test: ${u}`);
  }
  if (p.scope && (!onlyId || p.scope.feature === onlyId)) {
    out.push('');
    const ch = p.scope.changedInScope;
    out.push(`Scope: ${p.scope.feature} since ${String(p.scope.started).slice(0, 10)} · ${ch ? `${ch.length} files changed in scope` : 'no git'} · widened ${p.scope.widened}×`);
  }
  if (!onlyId && p.weekly.length) {
    out.push('', 'Week      built  checks  decisions  answers');
    for (const w of p.weekly) out.push(`${w.week}  ${String(w.built).padStart(5)}  ${String(w.checks).padStart(6)}  ${String(w.decisions).padStart(9)}  ${String(w.answered).padStart(7)}`);
  }
  return out.join('\n');
}
