import fs from 'node:fs';
import path from 'node:path';
import { fail, readJSON } from './util.mjs';

export const DEFAULT_CONFIG = {
  name: '',
  mode: 'full',
  docs: 'docs',
  decisions: 'docs/decisions',
  state: 'docs/STATE.md',
  areas: {
    P: { folder: 'platform', about: 'Infrastructure, vendors, code structure, security, authentication' },
    D: { folder: 'product', about: 'What a user sees, may do, or is promised' },
  },
  legacyBelow: {},
  owners: ['owner'],
  sessionOwner: false,
  ownerDecides: ['money', 'legal', 'a promise a user sees', 'the numbers of limits and settings'],
  code: ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,go,rs,kt,kts,swift,java,rb,php,cs}'],
  tests: {
    files: ['**/*.{test,spec}.*', '**/*Test.{kt,java}', '**/*Tests.swift', '**/test_*.py', '**/*_test.{go,py}'],
    require: 'case',
  },
  ignore: ['node_modules/**', '**/node_modules/**', 'dist/**', '**/dist/**', 'build/**', '**/build/**', '.keel/**', '**/.nuxt/**', '**/.output/**', '**/.turbo/**', '**/.wrangler/**', 'coverage/**', '**/vendor/**', '**/Pods/**', '.claude/**'],
  manifests: ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'build.gradle', 'build.gradle.kts', 'libs.versions.toml', 'Package.swift', 'Podfile', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json'],
  alwaysInScope: ['docs/**', '.keel/**'],
  gate: 'enforce',
  gateMaxBlocks: 2,
  verify: { quick: null, full: null, app: null, lint: null, types: null },
  pattern: null,
  stacks: [],
};

/** Finds the project root: the nearest folder above cwd holding .keel/project.json. */
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.keel', 'project.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadProject(start) {
  const root = findRoot(start);
  if (!root) fail('No keel project here.', 'Run `keel init` at the repository root first.');
  const raw = readJSON(path.join(root, '.keel', 'project.json'));
  const cfg = { ...DEFAULT_CONFIG, ...raw, tests: { ...DEFAULT_CONFIG.tests, ...(raw.tests || {}) } };
  validateConfig(cfg);
  return { root, cfg, paths: projectPaths(root, cfg) };
}

export function projectPaths(root, cfg) {
  const k = path.join(root, '.keel');
  return {
    keel: k,
    questions: path.join(k, 'questions.json'),
    features: path.join(k, 'features.json'),
    scope: path.join(k, 'scope.json'),
    baseline: path.join(k, 'baseline.json'),
    decisions: path.join(root, cfg.decisions),
    openQuestions: path.join(root, cfg.decisions, 'OPEN_QUESTIONS.md'),
    state: path.join(root, cfg.state),
  };
}

function validateConfig(cfg) {
  if (!['full', 'light'].includes(cfg.mode)) fail(`project.json: mode must be "full" or "light", got "${cfg.mode}".`);
  if (!cfg.areas || typeof cfg.areas !== 'object' || !Object.keys(cfg.areas).length) fail('project.json: areas must name at least one area.');
  for (const [letter, a] of Object.entries(cfg.areas)) {
    if (!/^[A-Z]$/.test(letter)) fail(`project.json: area key "${letter}" must be one capital letter.`);
    if (!a || typeof a.folder !== 'string' || !a.folder) fail(`project.json: area ${letter} needs a folder.`);
  }
  if (!['case', 'file', 'off'].includes(cfg.tests.require)) fail('project.json: tests.require must be "case", "file" or "off".');
  if (!['enforce', 'observe', 'off'].includes(cfg.gate)) fail('project.json: gate must be "enforce", "observe" or "off".');
  if (!Array.isArray(cfg.owners) || !cfg.owners.length) fail('project.json: owners must list at least one name.');
}
