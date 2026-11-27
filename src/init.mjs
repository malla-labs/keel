import fs from 'node:fs';
import path from 'node:path';
import { fail, writeJSON, writeText } from './util.mjs';
import { DEFAULT_CONFIG, projectPaths } from './config.mjs';
import { renderOpenQuestions } from './questions.mjs';
import { renderState } from './state.mjs';

/** Creates .keel/ and the docs skeleton. Never overwrites an existing file. */
export function init(root, opts = {}) {
  const cfgFile = path.join(root, '.keel', 'project.json');
  if (fs.existsSync(cfgFile)) fail('This project already has .keel/project.json.');
  const cfg = {
    name: opts.name ?? path.basename(path.resolve(root)),
    mode: opts.mode ?? 'full',
    docs: DEFAULT_CONFIG.docs,
    decisions: opts.decisions ?? DEFAULT_CONFIG.decisions,
    state: opts.state ?? DEFAULT_CONFIG.state,
    areas: opts.areas ?? DEFAULT_CONFIG.areas,
    owners: opts.owners ?? DEFAULT_CONFIG.owners,
    sessionOwner: Boolean(opts.sessionOwner),
    ownerDecides: DEFAULT_CONFIG.ownerDecides,
    pattern: opts.pattern ?? null,
    stacks: opts.stacks ?? [],
    gate: 'enforce',
    verify: { quick: null, full: null, app: null, lint: null, types: null },
  };
  if (!['full', 'light'].includes(cfg.mode)) fail('--mode must be "full" or "light".');
  writeJSON(cfgFile, cfg);
  const paths = projectPaths(root, { ...DEFAULT_CONFIG, ...cfg });
  const project = { root, cfg: { ...DEFAULT_CONFIG, ...cfg }, paths };
  const created = ['.keel/project.json'];
  const touch = (file, text) => {
    if (fs.existsSync(file)) return;
    writeText(file, text);
    created.push(path.relative(root, file));
  };
  touch(paths.questions, JSON.stringify({ lastId: 0, open: [] }, null, 2) + '\n');
  touch(paths.features, '{}\n');
  for (const a of Object.values(cfg.areas)) touch(path.join(paths.decisions, a.folder, '.gitkeep'), '');
  touch(paths.state, `# Project state\n\nThe one place that says what is built, what is real and what is mocked, and what waits for the owner. Write the hand-made sections above or below the generated block.\n\n## The project\n\n<!-- keel:summary -->\n<!-- /keel:summary -->\n\n## Where things stand\n\n<!-- keel:state -->\n<!-- /keel:state -->\n`);
  touch(path.join(root, '.keel', '.gitignore'), 'scope.json\n.gate.json\ngate.log\n');
  if (!fs.existsSync(paths.openQuestions)) { renderOpenQuestions(project); created.push(path.relative(root, paths.openQuestions)); }
  renderState(project);
  return { created };
}
