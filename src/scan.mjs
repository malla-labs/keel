import fs from 'node:fs';
import path from 'node:path';
import { matchesAny, walk } from './util.mjs';

const LANG = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', svelte: 'Svelte', py: 'Python', go: 'Go', rs: 'Rust', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift',
  java: 'Java', rb: 'Ruby', php: 'PHP', cs: 'C#', dart: 'Dart', sql: 'SQL',
};
const DOC_HINT = /(^|\/)(readme|claude|agents|architecture|overview|state|roadmap|spec|prd|decisions?|adr)[^/]*\.md$/i;

/**
 * Facts about the repository, read without judgement: languages, manifests and their test scripts,
 * the folder layout, test files, existing docs and decision records. The adopt skill starts from this.
 */
export function scan(project) {
  const { root, cfg } = project;
  const files = walk(root, cfg.ignore);
  const langs = {};
  for (const f of files) {
    const l = LANG[path.extname(f).slice(1)];
    if (l) langs[l] = (langs[l] ?? 0) + 1;
  }
  const manifests = files.filter((f) => cfg.manifests.includes(path.basename(f)) && !/lock|\.lockb$/.test(path.basename(f)));
  const scripts = {};
  for (const m of manifests.filter((f) => path.basename(f) === 'package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, m), 'utf8'));
      const s = Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter(([k]) => /^(test|e2e|verify|check|lint|typecheck|dev|build)/.test(k)));
      if (Object.keys(s).length) scripts[m] = s;
    } catch {}
  }
  const tests = files.filter((f) => matchesAny(f, cfg.tests.files));
  const testsByDir = countBy(tests, (f) => f.split('/').slice(0, 3).join('/'));
  const layout = countBy(files.filter((f) => LANG[path.extname(f).slice(1)]), (f) => {
    const parts = f.split('/');
    const deep = ['apps', 'packages', 'services', 'modules', 'features', 'src', 'lib', 'app'].includes(parts[0]) ? 3 : 2;
    return parts.slice(0, Math.min(deep, parts.length - 1)).join('/') || '.';
  });
  const docs = files.filter((f) => f.endsWith('.md') && (DOC_HINT.test(f) || f.split('/')[0] === 'docs'));
  const decisionDirs = [...new Set(files.filter((f) => /(^|\/)(adr|decisions?)\//i.test(f) && f.endsWith('.md')).map((f) => path.dirname(f)))];
  return {
    files: files.length,
    languages: sortDesc(langs),
    manifests,
    scripts,
    tests: { files: tests.length, byFolder: top(testsByDir, 25) },
    layout: top(layout, 40),
    docs: docs.slice(0, 60),
    docsTotal: docs.length,
    decisionFolders: decisionDirs.slice(0, 20),
  };
}

function countBy(list, key) {
  const m = {};
  for (const x of list) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
}

function sortDesc(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

function top(obj, n) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
}
