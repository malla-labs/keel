import fs from 'node:fs';
import path from 'node:path';
import { fail, matchesAny, readJSON, today, writeJSON } from './util.mjs';
import { getFeature, list, loadFeatures } from './features.mjs';
import { indexDecisions, loadDecisions } from './decisions.mjs';

export function loadScope(project) {
  return readJSON(project.paths.scope, null);
}

/** Locks edits to one feature's files. The feature's own globs plus any extra --files. */
export function startScope(project, featureId, extra) {
  const f = getFeature(loadFeatures(project), featureId);
  const files = [...new Set([...(f.files ?? []), ...list(extra)])];
  if (!files.length) fail(`Feature ${featureId} names no files.`, 'Pass --files with the globs this work may touch, or set them on the feature.');
  const scope = { feature: featureId, files, widened: [], deps: [], started: today() };
  writeJSON(project.paths.scope, scope);
  return scope;
}

export function widenScope(project, glob, reason) {
  const scope = loadScope(project);
  if (!scope) fail('No scope is active.', 'Start one with `keel scope start <feature>`.');
  if (!String(reason ?? '').trim()) fail('--reason is required: why the work must touch this path.');
  scope.files = [...new Set([...scope.files, ...list(glob)])];
  scope.widened.push({ glob, reason: String(reason).trim(), at: today() });
  writeJSON(project.paths.scope, scope);
  return scope;
}

/** Allows dependency changes, tied to an existing decision. Works with or without a feature scope. */
export function allowDeps(project, decisionId) {
  if (!indexDecisions(loadDecisions(project)).has(decisionId)) fail(`Decision ${decisionId} does not exist.`, 'A new dependency needs a decision record first (`keel decision new`).');
  const scope = loadScope(project) ?? { feature: null, files: null, widened: [], deps: [], started: today() };
  if (!scope.deps.includes(decisionId)) scope.deps.push(decisionId);
  writeJSON(project.paths.scope, scope);
  return scope;
}

export function clearScope(project) {
  if (fs.existsSync(project.paths.scope)) fs.rmSync(project.paths.scope);
  return { cleared: true };
}

const INSTALL_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:add|install|i)\s+[^-\s]|npx\s+[\w@/.-]+\s+add\b|pip3?\s+install\s+[^-\s]|poetry\s+add|uv\s+add|cargo\s+add|go\s+get|gem\s+install|bundle\s+add|composer\s+require|swift\s+package\s+add-dependency|pod\s+install)/;

const KEEL_WRITE_RE = /(?:>>?|\btee\b(?:\s+-a)?|\bsed\s+-i\S*(?:\s+''|\s+"")?(?:\s+-e)?\s+(?:'[^']*'|"[^"]*"|\S+)|\b(?:rm|mv|cp|truncate)\b[^|;&]*?)\s*\S*\.keel\/(?:(?:questions|scope|features|baseline|project)\.json|history\.jsonl)/;

/**
 * Decides one tool call. Returns { allow: true } or { allow: false, reason }.
 * File tools pass `rel` (path relative to the project root) and, when known, `content` (the file after the edit).
 * Bash passes `command` and `cwd`; every file the command writes is judged like a file edit.
 */
export function judge(project, { rel, command, cwd, content }) {
  const { cfg } = project;
  const scope = loadScope(project);
  if (command != null) {
    if (KEEL_WRITE_RE.test(command)) {
      return { allow: false, reason: 'Files under .keel/ are written by the keel CLI only. Use `keel question …`, `keel feature …` or `keel scope …`.' };
    }
    if (cfg.mode === 'light') return { allow: true };
    if (/\bgit\b[^|;&]*\b(?:commit|push|merge|rebase|am)\b[^|;&]*(?:--no-verify|\s-n\b|\s-[a-zA-Z]*n[a-zA-Z]*\s)/.test(command) && /\b(?:commit|push)\b/.test(command)) {
      return { allow: false, reason: 'Skipping git hooks (--no-verify) is not allowed for Claude. Fix what keel reports, or tell the user why it cannot pass; only the user may skip a hook.' };
    }
    if (INSTALL_RE.test(command) && !scope?.deps?.length) {
      return { allow: false, reason: 'Adding a dependency needs a decision. Write the record (`keel decision new`, kind engineering), then run `keel scope deps <ID>`.' };
    }
    for (const target of writeTargets(command, cwd ?? project.root)) {
      const r = path.relative(project.root, target).split(path.sep).join('/');
      if (r.startsWith('..') || path.isAbsolute(r)) continue;
      const v = judgeFile(project, scope, r, undefined);
      if (!v.allow) return { allow: false, reason: `${v.reason} (This Bash command writes ${r}; use Edit or Write for files, so keel can see the change.)` };
    }
    return { allow: true };
  }
  if (rel == null || rel.startsWith('..')) return { allow: true };
  return judgeFile(project, scope, rel, content);
}

function judgeFile(project, scope, rel, content) {
  const { cfg, paths } = project;
  const generated = path.relative(project.root, paths.openQuestions).split(path.sep).join('/');
  if (rel === generated) return { allow: false, reason: `${generated} is generated. Use \`keel question add\` or \`keel question answer\`.` };
  if (rel === '.keel/project.json') {
    return { allow: false, reason: '.keel/project.json holds the rules that check your work; a change cannot edit its own checks. Ask the user to change it.' };
  }
  if (['.keel/questions.json', '.keel/scope.json', '.keel/features.json', '.keel/baseline.json', '.keel/history.jsonl', '.keel/reviews.json', '.keel/architecture.json'].includes(rel)) {
    return { allow: false, reason: `${rel} is written by the keel CLI only. Use \`keel question …\`, \`keel feature …\` or \`keel scope …\`.` };
  }
  if (cfg.mode === 'light') return { allow: true };
  if (cfg.manifests.includes(path.basename(rel)) && !scope?.deps?.length && changesDependencies(project, rel, content)) {
    return { allow: false, reason: `${rel} declares dependencies. Changing them needs a decision: write the record (\`keel decision new\`, kind engineering), then run \`keel scope deps <ID>\`.` };
  }
  if (matchesAny(rel, cfg.alwaysInScope)) return { allow: true };
  if (!scope?.feature && matchesAny(rel, cfg.code) && !matchesAny(rel, cfg.ignore)) {
    return { allow: false, reason: `No feature is in progress, so code cannot change yet. Code belongs to a feature: run /keel:feature <id> (it registers the feature, its checks and its scope), or for an existing feature \`keel scope start <id>\`.` };
  }
  if (scope?.files && !matchesAny(rel, [...cfg.alwaysInScope, ...scope.files])) {
    return { allow: false, reason: `${rel} is outside the scope of ${scope.feature} (${scope.files.join(', ')}). If the work truly needs it, run \`keel scope widen '<glob>' --reason '<why>'\`; otherwise stay in scope.` };
  }
  return { allow: true };
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'overrides', 'resolutions'];

/** True unless the change is known to leave a package.json's dependency fields alone. */
function changesDependencies(project, rel, content) {
  if (path.basename(rel) !== 'package.json' || content === undefined) return true;
  let before = {};
  try { before = JSON.parse(fs.readFileSync(path.join(project.root, rel), 'utf8')); } catch {}
  let after;
  try { after = JSON.parse(content); } catch { return true; }
  return DEP_FIELDS.some((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/**
 * The command with heredoc bodies removed and quoted strings replaced by a placeholder, so text
 * inside a commit message or an echo (`<a@b.com>`, `a > b`) is never read as a redirect.
 */
export function shellCode(command) {
  let s = String(command);
  // Heredoc bodies: from the line after `<<[-]['"]?TAG['"]?` to the line holding only TAG.
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<HEREDOC$3');
  s = s.replace(/'[^']*'/g, "'Q'");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '"Q"');
  return s;
}

/** The files a shell command writes: redirects, tee, sed -i, cp and mv targets, after a leading `cd`. */
export function writeTargets(command, cwd) {
  let base = cwd;
  command = shellCode(command);
  const cd = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/.exec(command);
  if (cd) base = path.resolve(cwd, cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  const out = [];
  const add = (t) => { if (t && !t.startsWith('&') && t !== '/dev/null' && !t.startsWith('$') && !/^["']Q["']$/.test(t)) out.push(path.resolve(base, t.replace(/^["']|["']$/g, ''))); };
  for (const m of command.matchAll(/(?:^|[^<>&\d])>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g)) add(m[1]);
  for (const m of command.matchAll(/\btee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g)) add(m[1]);
  for (const m of command.matchAll(/\bsed\s+-i\S*(?:\s+''|\s+"")?\s+(?:-e\s+)?(?:'[^']*'|"[^"]*"|\S+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) add(m[1]);
  for (const m of command.matchAll(/\b(?:cp|mv)\s+(?:-\w+\s+)*(?:"[^"]+"|'[^']+'|\S+)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) add(m[1]);
  return out;
}
