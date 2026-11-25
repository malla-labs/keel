import fs from 'node:fs';
import path from 'node:path';
import { fail, slugify, today, writeText } from './util.mjs';

const ID_RE = /^([A-Z])-(\d+)$/;
// The "who" part may carry its own commas ("the lead, on the owner's request"); the date is always last.
const STATUS_RE = /^(proposed|accepted) \((.+), (\d{4}-\d{2}-\d{2})\)$|^superseded by ([A-Z]-\d+)(?: \((.+), (\d{4}-\d{2}-\d{2})\))?$/;

export function parseId(id) {
  const m = ID_RE.exec(String(id).trim());
  if (!m) fail(`"${id}" is not a decision id.`, 'A decision id is one capital letter, a dash and a number, such as S-048.');
  return { letter: m[1], num: Number(m[2]) };
}

export function formatId(letter, num) {
  return `${letter}-${String(num).padStart(3, '0')}`;
}

/** Parses one record file. Returns the record, plus problems found in its header. */
export function parseRecord(file, text) {
  const problems = [];
  const lines = text.split('\n');
  const base = path.basename(file);
  const fileId = /^([A-Z]-\d+)-/.exec(base)?.[1] ?? null;
  const title = /^# ([A-Z]-\d+): (.+)$/.exec(lines[0] ?? '');
  if (!fileId) problems.push(`file name must start with the id, such as S-048-<slug>.md`);
  if (!title) problems.push('first line must be "# <ID>: <title that states the rule>"');
  else if (fileId && title[1] !== fileId) problems.push(`title id ${title[1]} does not match file name id ${fileId}`);
  const head = lines.slice(1, 8);
  const statusLine = head.find((l) => l.startsWith('Status:'));
  const kindLine = head.find((l) => l.startsWith('Kind:'));
  let status = null;
  let by = null;
  let date = null;
  let supersededBy = null;
  if (statusLine) {
    const raw = statusLine.slice(7).trim();
    const m = STATUS_RE.exec(raw);
    if (!m) problems.push(`status line "${raw}" must be "proposed (<who>, <YYYY-MM-DD>)", "accepted (<who>, <YYYY-MM-DD>)" or "superseded by <ID>"`);
    else if (m[1]) { status = m[1]; by = m[2].trim(); date = m[3]; }
    else { status = 'superseded'; supersededBy = m[4]; by = m[5]?.trim() ?? null; date = m[6] ?? null; }
  }
  let kind = null;
  if (kindLine) {
    kind = kindLine.slice(5).trim();
    if (!['product', 'engineering'].includes(kind)) problems.push(`kind "${kind}" must be "product" or "engineering"`);
  }
  return {
    id: fileId ?? title?.[1] ?? null,
    title: title?.[2] ?? null,
    file,
    status,
    by,
    date,
    kind,
    supersededBy,
    hasStatusLine: Boolean(statusLine),
    hasKindLine: Boolean(kindLine),
    problems,
  };
}

/** Reads every record under the decisions folder, area by area. */
export function loadDecisions(project) {
  const { cfg, paths } = project;
  const records = [];
  for (const [letter, area] of Object.entries(cfg.areas)) {
    const dir = path.join(paths.decisions, area.folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(dir, name);
      const rec = parseRecord(file, fs.readFileSync(file, 'utf8'));
      rec.area = letter;
      if (rec.id && !rec.id.startsWith(letter + '-')) rec.problems.push(`id ${rec.id} is in folder ${area.folder}, which holds ${letter}- records`);
      const legacy = cfg.legacyBelow?.[letter];
      rec.legacy = rec.id && legacy != null && parseId(rec.id).num <= legacy;
      if (!rec.hasStatusLine && rec.legacy) rec.status = 'accepted';
      records.push(rec);
    }
  }
  return records;
}

export function indexDecisions(records) {
  const byId = new Map();
  for (const r of records) if (r.id) byId.set(r.id, r);
  return byId;
}

export function nextId(project, letter) {
  if (!project.cfg.areas[letter]) fail(`Area "${letter}" is not configured.`, `Configured areas: ${areaList(project.cfg)}.`);
  const nums = loadDecisions(project).filter((r) => r.id?.startsWith(letter + '-')).map((r) => parseId(r.id).num);
  return formatId(letter, nums.length ? Math.max(...nums) + 1 : 1);
}

export function areaList(cfg) {
  return Object.entries(cfg.areas).map(([l, a]) => `${l} (${a.folder}: ${a.about ?? ''})`).join('; ');
}

const SECTIONS = ['Context', 'Decision', 'Why', 'Alternatives rejected', 'Consequences', 'Code', 'Flows'];

/**
 * Writes a new record. Product records are proposed unless an owner accepts them.
 * Supersedes the old record in the same call when `supersedes` is given.
 */
export function newDecision(project, opts) {
  const { cfg, paths } = project;
  const letter = String(opts.area ?? '').toUpperCase();
  const area = cfg.areas[letter];
  if (!area) fail(`Area "${opts.area}" is not configured.`, `Pick one of: ${areaList(cfg)}.`);
  const title = String(opts.title ?? '').trim();
  if (title.length < 8) fail('The title must state the rule in a sentence (8 characters or more).');
  if (/[\n\r]/.test(title)) fail('The title must be one line.');
  const kind = opts.kind;
  if (!['product', 'engineering'].includes(kind)) fail('--kind must be "product" or "engineering".', `Product: ${cfg.ownerDecides.join(', ')}. Everything else is engineering.`);
  const by = String(opts.by ?? '').trim();
  if (!by) fail('--by is required: who stated or proposed this rule.');
  let status = opts.status ?? 'proposed';
  if (!['proposed', 'accepted'].includes(status)) fail('--status must be "proposed" or "accepted".');
  if (status === 'accepted' && kind === 'product' && !cfg.owners.includes(by)) {
    fail(`Only an owner (${cfg.owners.join(', ')}) accepts a product rule; "${by}" may only propose it.`, 'Write it with --status proposed and ask the owner with `keel question add`.');
  }
  if (kind === 'product' && status === 'accepted' && !String(opts.quote ?? '').trim()) {
    fail('An accepted product rule must quote the owner: pass --quote with their words.');
  }
  const date = opts.date ?? today();
  let old = null;
  const records = loadDecisions(project);
  const byId = indexDecisions(records);
  if (opts.supersedes) {
    parseId(opts.supersedes);
    old = byId.get(opts.supersedes);
    if (!old) fail(`Cannot supersede ${opts.supersedes}: no such record.`);
    if (old.status === 'superseded') fail(`${old.id} is already superseded by ${old.supersededBy}. Supersede ${old.supersededBy} instead.`);
  }
  const id = nextId(project, letter);
  const slug = slugify(title);
  if (!slug) fail('The title has no letters or digits to make a file name from.');
  const file = path.join(paths.decisions, area.folder, `${id}-${slug}.md`);
  const body = {
    Context: opts.context,
    Decision: opts.decision,
    Why: opts.why,
    'Alternatives rejected': opts.alternatives ?? 'Not recorded.',
    Consequences: opts.consequences,
    Code: opts.code ?? 'None yet.',
    Flows: opts.flows ?? 'None.',
  };
  if (opts.quote) body.Why = `${cfg.owners.includes(by) ? `The ${by}` : by}, ${date}: "${String(opts.quote).trim()}"` + (body.Why ? `\n\n${body.Why}` : '');
  if (old) body.Context = `Replaces ${old.id} (${old.title}).` + (body.Context ? `\n\n${body.Context}` : '');
  if (!String(body.Decision ?? '').trim()) fail('--decision is required: the rule, stated exactly, with every number and its unit.');
  if (!String(body.Why ?? '').trim()) body.Why = `Unknown. Needs the owner's answer: why ${title.charAt(0).toLowerCase() + title.slice(1)}?`;
  let text = `# ${id}: ${title}\n\nStatus: ${status} (${by}, ${date})\nKind: ${kind}\n`;
  for (const s of SECTIONS) text += `\n## ${s}\n\n${String(body[s] ?? 'Not recorded.').trim()}\n`;
  text += `\n## Revision\n\nNone.\n`;
  writeText(file, text);
  if (old) markSuperseded(old, id, by, date);
  return { id, file, superseded: old?.id ?? null, status, kind };
}

function markSuperseded(old, newId, by, date) {
  const text = fs.readFileSync(old.file, 'utf8');
  const lines = text.split('\n');
  const line = `Status: superseded by ${newId} (${by}, ${date})`;
  const i = lines.findIndex((l, n) => n < 8 && l.startsWith('Status:'));
  if (i >= 0) lines[i] = line;
  else lines.splice(1, 0, '', line);
  fs.writeFileSync(old.file, lines.join('\n'));
}

/** Accepts a proposed record: the one status change allowed besides superseding. */
export function acceptDecision(project, id, by, quote) {
  const { cfg } = project;
  const rec = indexDecisions(loadDecisions(project)).get(id);
  if (!rec) fail(`No record ${id}.`);
  if (rec.status !== 'proposed') fail(`${id} is ${rec.status}, not proposed.`);
  if (rec.kind === 'product' && !cfg.owners.includes(by)) fail(`Only an owner (${cfg.owners.join(', ')}) accepts a product rule.`);
  if (rec.kind === 'product' && !String(quote ?? '').trim()) fail('Accepting a product rule needs --quote with the owner\'s words.');
  const date = today();
  let text = fs.readFileSync(rec.file, 'utf8');
  text = text.replace(/^Status: .*$/m, `Status: accepted (${by}, ${date})`);
  if (quote) text = text.replace(/^## Why\n\n/m, `## Why\n\nThe ${by}, ${date}: "${String(quote).trim()}"\n\n`);
  fs.writeFileSync(rec.file, text);
  return { id, status: 'accepted' };
}
