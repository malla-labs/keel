import path from 'node:path';
import { fail, readJSON, today, writeJSON } from './util.mjs';
import { getFeature, loadFeatures } from './features.mjs';

export const SEVERITIES = ['important', 'nit', 'pre-existing'];
export const VERDICTS = ['confirmed', 'rejected'];
const EMPTY = { lastId: 0, findings: [] };

function file(project) {
  return path.join(project.paths.keel, 'reviews.json');
}

export function loadReviews(project) {
  const store = readJSON(file(project), EMPTY);
  return { lastId: store.lastId ?? 0, findings: store.findings ?? [] };
}

function save(project, store) {
  writeJSON(file(project), store);
}

function parseRef(ref) {
  const n = Number(String(ref ?? '').replace(/^R-?/i, ''));
  if (!Number.isInteger(n) || n < 1) fail(`"${ref}" is not a finding number, such as R-3.`);
  return n;
}

/**
 * Records one review finding with the verifier's verdict. A rejected finding is kept, closed,
 * so the next review does not raise it again; a confirmed one stays open until it is resolved.
 */
export function addFinding(project, opts) {
  const feature = String(opts.feature ?? '').trim();
  if (!feature) fail('--feature is required: the feature the reviewed diff belongs to.');
  getFeature(loadFeatures(project), feature);
  const summary = String(opts.summary ?? '').trim();
  if (summary.length < 8) fail('--summary is required: the problem, in a sentence.');
  const severity = String(opts.severity ?? '').trim();
  if (!SEVERITIES.includes(severity)) fail(`--severity must be one of ${SEVERITIES.join(', ')}.`);
  const verdict = String(opts.verdict ?? '').trim();
  if (!VERDICTS.includes(verdict)) fail(`--verdict must be one of ${VERDICTS.join(', ')}: what the verifier concluded.`);
  const store = loadReviews(project);
  const id = store.lastId + 1;
  store.lastId = id;
  const finding = {
    id,
    feature,
    severity,
    verdict,
    summary,
    ...(opts.where ? { where: String(opts.where).trim() } : {}),
    ...(opts.reason ? { reason: String(opts.reason).trim() } : {}),
    status: verdict === 'rejected' ? 'rejected' : 'open',
    added: today(),
  };
  if (verdict === 'rejected' && !finding.reason) fail('--reason is required for a rejected finding: why the verifier refuted it.');
  store.findings.push(finding);
  save(project, store);
  return { id: `R-${id}`, status: finding.status };
}

/** Closes an open finding: fixed (what changed) or answered (why it stays as it is). */
export function resolveFinding(project, ref, opts) {
  const n = parseRef(ref);
  const store = loadReviews(project);
  const f = store.findings.find((x) => x.id === n);
  if (!f) fail(`R-${n} does not exist.`);
  if (f.status !== 'open') fail(`R-${n} is already ${f.status}.`);
  const fixed = opts.fixed && opts.fixed !== true ? String(opts.fixed).trim() : '';
  const answered = opts.answered && opts.answered !== true ? String(opts.answered).trim() : '';
  if (Boolean(fixed) === Boolean(answered)) fail('Pass exactly one of --fixed "<what changed>" or --answered "<why it stays>".');
  f.status = fixed ? 'fixed' : 'answered';
  f.resolution = fixed || answered;
  f.resolved = today();
  save(project, store);
  return { id: `R-${n}`, status: f.status };
}

export function openFindings(project, feature) {
  return loadReviews(project).findings.filter((f) => f.status === 'open' && (!feature || f.feature === feature));
}

export function formatFinding(f) {
  const where = f.where ? `${f.where}: ` : '';
  const end = f.resolution ? ` → ${f.status}: ${f.resolution}` : f.reason ? ` (${f.reason})` : '';
  return `R-${f.id} ${f.status.padEnd(8)} ${f.severity.padEnd(12)} ${f.feature}  ${where}${f.summary}${end}`;
}
