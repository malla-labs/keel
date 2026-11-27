import fs from 'node:fs';
import path from 'node:path';
import { writeText } from './util.mjs';

/**
 * A GitHub Actions workflow that holds keel's rules on every pull request, also for people and
 * tools without keel installed: keel check --strict, then keel verify (tests, lint, types).
 * Pinned to the keel version that wrote it, so a CI run never changes under the team.
 */
export function writeCiWorkflow(project, version) {
  const file = path.join(project.root, '.github', 'workflows', 'keel.yml');
  const keel = `npx --yes github:malla-labs/keel#v${version}`;
  const hasLock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].find((f) => fs.existsSync(path.join(project.root, f)));
  const install = hasLock === 'package-lock.json' ? '      - run: npm ci\n'
    : hasLock === 'pnpm-lock.yaml' ? '      - run: corepack enable && pnpm install --frozen-lockfile\n'
      : hasLock === 'yarn.lock' ? '      - run: corepack enable && yarn install --immutable\n' : '';
  const verify = project.cfg.verify?.quick ? `      - name: keel verify (tests, lint, types)\n        run: ${keel} verify\n` : '';
  const text = `# Written by \`keel ci github\` (keel ${version}). Holds keel's rules on every pull request.
name: keel
on:
  pull_request:
  push:
    branches: [main]
jobs:
  keel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
${install}      - name: keel check
        run: ${keel} check --strict
${verify}`;
  const existed = fs.existsSync(file);
  writeText(file, text);
  return { file: path.relative(project.root, file), replaced: existed, verify: Boolean(verify) };
}
