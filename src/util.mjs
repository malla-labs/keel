import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class KeelError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

export function fail(message, hint) {
  throw new KeelError(message, hint);
}

export function today() {
  if (process.env.KEEL_TODAY) return process.env.KEEL_TODAY;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function readJSON(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return structuredClone(fallback);
    fail(`Missing file: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`Invalid JSON in ${file}: ${e.message}`);
  }
}

export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Converts a glob (`**`, `*`, `?`, `{a,b}`) to an anchored RegExp on `/` paths. */
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesAny(rel, globs) {
  const p = rel.split(path.sep).join('/');
  return globs.some((g) => globToRegex(g).test(p));
}

/** Lists files under root (relative, `/` separated), skipping ignored globs and .git. */
export function walk(root, ignore = []) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git') continue;
      if (e.isDirectory()) {
        if (matchesAny(r + '/', ignore) || matchesAny(r, ignore)) continue;
        stack.push(r);
      } else if (e.isFile() && !matchesAny(r, ignore)) out.push(r);
    }
  }
  return out.sort();
}

/** Files changed against HEAD plus untracked ones, or null outside a git repo. */
export function gitChanged(root) {
  try {
    const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const tracked = run(['diff', '--name-only', 'HEAD']).split('\n');
    const untracked = run(['ls-files', '--others', '--exclude-standard']).split('\n');
    return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
  } catch {
    return null;
  }
}

export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

// `Decision: P-001` or a list, `Decision: D-001, P-004, P-006`. Every id in the list counts as cited.
const CITE_LIST_RE = /\bDecision:\s*([A-Z]-\d+(?:\s*,\s*[A-Z]-\d+)*)/g;

/** The decision ids a text cites, in order, with repeats. */
export function citedDecisions(text) {
  const ids = [];
  for (const m of String(text).matchAll(CITE_LIST_RE)) ids.push(...m[1].split(',').map((s) => s.trim()));
  return ids;
}

// `Q-3`, as written in code comments that point at an open question.
const QUESTION_REF_RE = /\bQ-(\d+)\b/g;
// Where a comment starts on a line: //, #, /*, a leading *, --, <!--. Only the text after it is read,
// so a string such as "Q-7" (a part number, a quarter) is never taken for a question.
const COMMENT_START_RE = /\/\/|\/\*|<!--|(?:^|\s)#|(?:^|\s)--\s|^\s*\*/;

/** The question numbers a line's comment names. Code outside the comment is ignored. */
export function citedQuestions(line) {
  const m = COMMENT_START_RE.exec(String(line));
  if (!m) return [];
  return [...String(line).slice(m.index).matchAll(QUESTION_REF_RE)].map((x) => Number(x[1]));
}
