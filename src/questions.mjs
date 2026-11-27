import fs from 'node:fs';
import path from 'node:path';
import { fail, readJSON, today, writeJSON, writeText } from './util.mjs';
import { indexDecisions, loadDecisions } from './decisions.mjs';
import { loadFeatures, saveFeatures } from './features.mjs';

const EMPTY = { lastId: 0, open: [] };
const KEYS = ['A', 'B', 'C', 'D'];

export function loadQuestions(project) {
  return readJSON(project.paths.questions, EMPTY);
}

/** Returns every problem with one question; an empty list means it follows the pattern. */
export function questionProblems(q, project, { wording = true } = {}) {
  const p = [];
  if (!['product', 'engineering'].includes(q.kind)) p.push('kind must be "product" or "engineering"');
  const text = String(q.question ?? '').trim();
  if (!text) p.push('question is empty');
  else {
    if (wording && !text.endsWith('?')) p.push('question must end with "?"');
    if (wording && (text.match(/\?/g) || []).length > 1) p.push('question must ask one thing (one "?")');
    if (wording && /(?:,|;)?\s+(?:and|or|also|plus)\s+(?:does|do|is|are|should|what|who|when|where|how|which|can|could|will|would|must)\b/i.test(text)) p.push('question must ask one thing: it joins a second question with "and/or …"; split it into two questions');
    if (wording && text.length > 300) p.push('question must be 300 characters or fewer; put detail in "blocks"');
  }
  if (!String(q.blocks ?? '').trim()) p.push('blocks is empty: say what this answer unblocks; a question that blocks nothing is not asked');
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length < 2 || opts.length > 4) p.push('options must be 2 to 4');
  const rec = opts.filter((o) => o.recommended);
  if (rec.length !== 1) p.push('exactly one option must be recommended');
  opts.forEach((o, i) => {
    if (o.key !== KEYS[i]) p.push(`option ${i + 1} must have key ${KEYS[i]}`);
    if (!String(o.text ?? '').trim()) p.push(`option ${KEYS[i]} has no text`);
  });
  if (!String(q.default ?? '').trim()) p.push('default is empty: say what gets built if nobody answers, and how it is reversed');
  if (q.feature && project) {
    const features = loadFeatures(project);
    if (!features[q.feature]) p.push(`feature "${q.feature}" is not in .keel/features.json`);
  }
  if (q.decision && project) {
    if (!indexDecisions(loadDecisions(project)).has(q.decision)) p.push(`decision ${q.decision} does not exist`);
  }
  return p;
}

/**
 * Adds a question. Options come as plain strings; the one marked with a leading "*" is recommended.
 * Numbers are never reused.
 */
export function addQuestion(project, input) {
  const options = (input.options ?? []).map((o, i) => {
    const raw = typeof o === 'string' ? o : o.text;
    const recommended = typeof o === 'string' ? raw.trim().startsWith('*') : Boolean(o.recommended);
    const clean = String(raw ?? '').trim().replace(/^\*\s*/, '').replace(/^\(?[A-Da-d1-4][).:\]]\s+/, '');
    return { key: KEYS[i], text: clean, ...(recommended ? { recommended: true } : {}) };
  });
  const q = {
    kind: input.kind,
    question: String(input.question ?? '').trim(),
    blocks: String(input.blocks ?? '').trim(),
    options,
    default: String(input.default ?? '').trim(),
    ...(input.feature ? { feature: input.feature } : {}),
    ...(input.decision ? { decision: input.decision } : {}),
  };
  const problems = questionProblems(q, project);
  if (problems.length) fail(`The question does not follow the pattern:\n- ${problems.join('\n- ')}`);
  const store = loadQuestions(project);
  const dup = store.open.find((o) => o.question.toLowerCase() === q.question.toLowerCase());
  if (dup) fail(`The same question is already open as Q-${dup.id}.`);
  const id = store.lastId + 1;
  store.lastId = id;
  store.open.push({ id, ...q, asked: today() });
  writeJSON(project.paths.questions, store);
  renderOpenQuestions(project);
  return { id, kind: q.kind };
}

/**
 * Answers a question: it leaves the open list, the answer is filed in the day's resolutions,
 * and what remains to build is added to the feature's work list.
 */
export function answerQuestion(project, idArg, opts) {
  const { cfg } = project;
  const id = Number(String(idArg).replace(/^Q-?/i, ''));
  const store = loadQuestions(project);
  const i = store.open.findIndex((q) => q.id === id);
  if (i === -1) fail(`Q-${id} is not open.`, 'List open questions with `keel question list`.');
  const q = store.open[i];
  const by = String(opts.by ?? '').trim();
  if (!by) fail('--by is required: who answered.');
  if (q.kind === 'product' && !cfg.owners.includes(by)) fail(`Q-${id} is a product question: only an owner (${cfg.owners.join(', ')}) answers it.`);
  let answer = String(opts.answer ?? '').trim();
  if (!answer) fail('--answer is required.');
  const opt = q.options.find((o) => o.key === answer.toUpperCase());
  if (opt) answer = `${opt.key}) ${opt.text}`;
  if (opts.decision && !indexDecisions(loadDecisions(project)).has(opts.decision)) fail(`Decision ${opts.decision} does not exist. Write it first with \`keel decision new\`.`);
  const date = today();
  const where = opts.decision ?? (opts.work ? 'Work list' : 'This file');
  const quote = opts.quote ? ` ("${String(opts.quote).trim()}")` : '';
  appendResolution(project, date, `| Q-${id} | ${cell(q.question)} | ${cell(answer + quote)} | ${by} | ${cell(where)} |`);
  if (opts.work) {
    const features = loadFeatures(project);
    const fid = q.feature;
    if (!fid) fail(`Q-${id} names no feature, so --work has nowhere to go. Pass --feature <id> or record the work in the decision.`);
    features[fid].work = [...(features[fid].work ?? []), { text: String(opts.work).trim(), from: `Q-${id}`, added: date }];
    saveFeatures(project, features);
  }
  store.open.splice(i, 1);
  store.closed = [...(store.closed ?? []), { id, answered: date, by, ...(opts.decision ? { decision: opts.decision } : {}) }];
  writeJSON(project.paths.questions, store);
  renderOpenQuestions(project);
  return { id, answer, filed: path.relative(project.root, resolutionFile(project, date)) };
}

/** Withdraws a question nobody needs answered, or one to be replaced by better-worded ones. */
export function withdrawQuestion(project, idArg, opts) {
  const id = Number(String(idArg).replace(/^Q-?/i, ''));
  const store = loadQuestions(project);
  const i = store.open.findIndex((q) => q.id === id);
  if (i === -1) fail(`Q-${id} is not open.`);
  const reason = String(opts.reason ?? '').trim();
  if (!reason) fail('--reason is required: why the question is withdrawn, and what replaces it (Q-numbers).');
  const by = String(opts.by ?? '').trim();
  if (!by) fail('--by is required.');
  const q = store.open[i];
  appendResolution(project, today(), `| Q-${id} | ${cell(q.question)} | Withdrawn: ${cell(reason)} | ${by} | — |`);
  store.open.splice(i, 1);
  store.closed = [...(store.closed ?? []), { id, withdrawn: today(), by }];
  writeJSON(project.paths.questions, store);
  renderOpenQuestions(project);
  return { id, withdrawn: true };
}

function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function resolutionFile(project, date) {
  return path.join(project.paths.decisions, `RESOLUTIONS_${date}.md`);
}

function appendResolution(project, date, row) {
  const file = resolutionFile(project, date);
  if (!fs.existsSync(file)) {
    writeText(file, `# Resolutions, ${date}\n\n| Question | Asked | Answer | By | Recorded in |\n|---|---|---|---|---|\n`);
  }
  fs.appendFileSync(file, row + '\n');
}

export const GENERATED_NOTE = '<!-- Generated by keel from .keel/questions.json. Do not edit: use `keel question add` and `keel question answer`. -->';

export function renderOpenQuestionsText(project) {
  const store = loadQuestions(project);
  let out = `# Open questions\n\n${GENERATED_NOTE}\n\nOnly questions nobody has answered. A question leaves this file the moment it is answered; its answer is in a \`RESOLUTIONS_<date>.md\` file or a decision record. Numbers are never reused.\n`;
  for (const [kind, heading] of [['product', 'For the owner'], ['engineering', 'Engineering']]) {
    const qs = store.open.filter((q) => q.kind === kind);
    out += `\n## ${heading}\n\n`;
    if (!qs.length) { out += 'None.\n'; continue; }
    for (const q of qs) out += formatQuestion(q) + '\n';
  }
  return out;
}

export function formatQuestion(q) {
  const tags = [q.kind, q.feature, q.decision].filter(Boolean).join(' · ');
  let s = `### Q-${q.id} · ${tags}\n\n**Question:** ${q.question}\n\n**Why it blocks:** ${q.blocks}\n\n**Options:**\n\n`;
  for (const o of q.options) s += `- ${o.key}) ${o.text}${o.recommended ? ' **(recommended)**' : ''}\n`;
  s += `\n**Default if no answer:** ${q.default}\n\n_Asked ${q.asked}._\n`;
  return s;
}

export function renderOpenQuestions(project) {
  writeText(project.paths.openQuestions, renderOpenQuestionsText(project));
}
