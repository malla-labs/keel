import fs from 'node:fs';
import path from 'node:path';
import { fail, matchesAny, readJSON, writeJSON, writeText } from './util.mjs';
import { indexDecisions, loadDecisions } from './decisions.mjs';

// The project's modules: what each one is for, which files it owns, and which other modules it may use.
// Written by `keel module …` only; every rule names the decision record behind it.

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const BEGIN = '<!-- keel:architecture -->';
const END = '<!-- /keel:architecture -->';
const EMPTY = { modules: {} };

// Relative imports in JS and TS: import … from './x', import './x', export … from './x', import('./x'), require('./x').
const IMPORT_RES = [
  /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];
const RESOLVE_EXTS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '/index.js', '/index.ts', '/index.mjs'];

function file(project) {
  return path.join(project.paths.keel, 'architecture.json');
}

export function architecturePath(project) {
  return path.join(project.root, project.cfg.docs ?? 'docs', 'ARCHITECTURE.md');
}

export function loadArchitecture(project) {
  const a = readJSON(file(project), EMPTY);
  return { modules: a.modules ?? {} };
}

function list(v) {
  if (v == null || v === true) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
}

function requireDecision(project, id) {
  if (!id || id === true) fail('--decision is required: the record that states this structure rule (`/keel:decide` first).');
  if (!indexDecisions(loadDecisions(project)).has(id)) fail(`Decision ${id} does not exist. Write it first with \`keel decision new\`.`);
  return id;
}

/** Adds a module, or changes one: its files, what it is for, and the modules it may use. */
export function setModule(project, name, opts, { create }) {
  if (!NAME_RE.test(String(name ?? ''))) fail(`Module name "${name}" must be one lowercase word (dashes allowed), such as auth.`);
  const arch = loadArchitecture(project);
  const exists = Boolean(arch.modules[name]);
  if (create && exists) fail(`Module "${name}" already exists. Change it with \`keel module set\`.`);
  if (!create && !exists) fail(`No module "${name}". Known: ${Object.keys(arch.modules).join(', ') || 'none'}.`);
  const decision = requireDecision(project, opts.decision);
  const m = arch.modules[name] ?? { about: '', files: [], uses: [], decisions: [] };
  if (opts.about) m.about = String(opts.about).trim();
  if (opts.files) m.files = list(opts.files);
  if (opts.uses != null) m.uses = list(opts.uses);
  if (create && !m.about) fail('--about is required: what the module is for, in a sentence.');
  if (!m.files.length) fail('--files is required: the globs the module owns.');
  for (const u of m.uses) {
    if (u === name) fail('A module does not list itself in --uses.');
    if (!arch.modules[u]) fail(`--uses names "${u}", which is not a module. Add it first.`);
  }
  if (!m.decisions.includes(decision)) m.decisions.push(decision);
  arch.modules[name] = m;
  writeJSON(file(project), { modules: Object.fromEntries(Object.keys(arch.modules).sort().map((k) => [k, arch.modules[k]])) });
  renderArchitecture(project);
  return { module: name, ...m };
}

/** The module that owns a project-relative path, or null. The first match in name order wins. */
export function moduleOf(arch, rel) {
  for (const [name, m] of Object.entries(arch.modules)) if (matchesAny(rel, m.files)) return name;
  return null;
}

/** The project-relative files a line imports with a relative path, resolved against the importing file. */
export function relativeImports(root, fromRel, line) {
  const out = [];
  for (const re of IMPORT_RES) {
    for (const m of line.matchAll(re)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), m[1]));
      if (base.startsWith('..')) continue;
      const hit = RESOLVE_EXTS.map((e) => base + e).find((c) => fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile());
      out.push({ spec: m[1], target: hit ?? base });
    }
  }
  return out;
}

/**
 * Boundary problems in one code file: an import of another module that this module may not use.
 * Returns [{ line, message }].
 */
export function boundaryProblems(project, arch, rel, lines) {
  const from = moduleOf(arch, rel);
  if (!from) return [];
  const m = arch.modules[from];
  const problems = [];
  lines.forEach((line, i) => {
    for (const imp of relativeImports(project.root, rel, line)) {
      const to = moduleOf(arch, imp.target);
      if (!to || to === from || m.uses.includes(to)) continue;
      problems.push({ line: i + 1, message: `module ${from} imports ${imp.target} (module ${to}), which ${from} may not use (${m.decisions.join(', ')}). Use what ${from} may use (${m.uses.join(', ') || 'nothing'}), or change the rule with \`keel module set ${from} --uses … --decision <ID>\`.` });
    }
  });
  return problems;
}

export function renderArchitectureText(project, current) {
  const arch = loadArchitecture(project);
  const names = Object.keys(arch.modules);
  let block = `${BEGIN}\n<!-- Generated by keel from .keel/architecture.json. Change it with \`keel module add|set\`. -->\n\n`;
  if (!names.length) block += 'No modules yet.\n';
  else {
    block += '| Module | For | Files | May use | Decisions |\n|---|---|---|---|---|\n';
    for (const n of names) {
      const m = arch.modules[n];
      block += `| ${n} | ${m.about.replace(/\|/g, '\\|')} | ${m.files.map((f) => `\`${f}\``).join(', ')} | ${m.uses.join(', ') || '—'} | ${m.decisions.join(', ')} |\n`;
    }
    block += '\nA module imports only itself and the modules in its "May use" column; `keel check` fails on any other import.\n';
  }
  block += END;
  const text = current ?? `# Architecture\n\nWrite the hand-made parts (diagrams, the reasons behind the layout) above or below the generated block.\n\n${BEGIN}\n${END}\n`;
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a === -1 || b === -1) return `${text.trimEnd()}\n\n${block}\n`;
  return text.slice(0, a) + block + text.slice(b + END.length);
}

export function renderArchitecture(project) {
  const f = architecturePath(project);
  const current = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const next = renderArchitectureText(project, current);
  if (next !== current) writeText(f, next);
}

export function formatModules(arch) {
  const names = Object.keys(arch.modules);
  if (!names.length) return 'No modules. Add them with `keel module add <name> --about … --files … [--uses …] --decision <ID>`.';
  return names.map((n) => {
    const m = arch.modules[n];
    return `${n.padEnd(14)} ${m.files.join(', ').padEnd(32)} uses ${m.uses.join(', ') || '—'}  · ${m.about}`;
  }).join('\n');
}
