import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fail } from './util.mjs';

const BEGIN = '# keel:begin (managed by `keel githooks`; do not edit inside)';
const END = '# keel:end';
export const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** The folder git runs hooks from: core.hooksPath (husky and others) or .git/hooks. */
export function hooksDir(root) {
  let top;
  try { top = git(root, ['rev-parse', '--show-toplevel']); } catch { fail('Not a git repository.'); }
  let custom = '';
  try { custom = git(root, ['config', '--get', 'core.hooksPath']); } catch {}
  if (custom) return path.resolve(top, custom);
  return path.resolve(top, git(root, ['rev-parse', '--git-path', 'hooks']));
}

/**
 * The block each hook runs. It finds keel on PATH, else the CLI that installed it.
 * Without keel it prints a note and lets git go on: a hook must never lock out someone without keel.
 */
function block(hook, cli) {
  const find = `KEEL="$(command -v keel 2>/dev/null)"; [ -z "$KEEL" ] && [ -f "${cli}" ] && KEEL="node ${cli}"
if [ -z "$KEEL" ]; then echo "keel: not installed, ${hook} checks skipped" >&2; else`;
  const run = {
    'pre-commit': `  $KEEL hook git pre-commit || exit $?`,
    'commit-msg': `  $KEEL hook git commit-msg "$1" || exit $?`,
    'pre-push': `  $KEEL hook git pre-push || exit $?`,
  }[hook];
  return `${BEGIN}\n${find}\n${run}\nfi\n${END}`;
}

export function installHooks(root, cli) {
  const dir = hooksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const done = [];
  for (const hook of HOOKS) {
    const file = path.join(dir, hook);
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '#!/bin/sh\n';
    const mine = block(hook, cli);
    const a = text.indexOf(BEGIN);
    const b = text.indexOf(END);
    if (a !== -1 && b !== -1) text = text.slice(0, a) + mine + text.slice(b + END.length);
    else {
      // Run before an existing hook's own `exit`, so an `exit 0` at its end cannot skip keel.
      const lines = text.split('\n');
      const shebang = lines[0].startsWith('#!') ? lines.shift() : '#!/bin/sh';
      text = [shebang, mine, ...lines].join('\n');
    }
    fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
    fs.chmodSync(file, 0o755);
    done.push(path.relative(root, file) || file);
  }
  return { dir, installed: done };
}

export function uninstallHooks(root) {
  const dir = hooksDir(root);
  const removed = [];
  for (const hook of HOOKS) {
    const file = path.join(dir, hook);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const a = text.indexOf(BEGIN);
    const b = text.indexOf(END);
    if (a === -1 || b === -1) continue;
    const after = text.slice(b + END.length).replace(/^\n/, '');
    const rest = text.slice(0, a) + after;
    if (rest.replace(/^#!.*\n?/, '').trim() === '') fs.rmSync(file);
    else fs.writeFileSync(file, rest);
    removed.push(hook);
  }
  return { dir, removed };
}

export function hooksStatus(root) {
  const dir = hooksDir(root);
  return Object.fromEntries(HOOKS.map((h) => {
    const f = path.join(dir, h);
    return [h, fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(BEGIN) ? 'installed' : 'missing'];
  }));
}

/** Adds a `Feature: <id>` trailer when a scope is active and the message names no feature yet. */
export function addFeatureTrailer(msgFile, feature) {
  if (!feature || !fs.existsSync(msgFile)) return false;
  const text = fs.readFileSync(msgFile, 'utf8');
  const body = text.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  if (!body.trim() || /^Feature: /m.test(body)) return false;
  const lines = text.split('\n');
  const firstComment = lines.findIndex((l) => l.startsWith('#'));
  const head = (firstComment === -1 ? lines : lines.slice(0, firstComment)).join('\n').replace(/\s+$/, '');
  const tail = firstComment === -1 ? '' : '\n' + lines.slice(firstComment).join('\n');
  // Join an existing trailer block (Co-Authored-By and others) instead of starting a new paragraph.
  const lastPara = head.split('\n\n').pop();
  const isTrailers = lastPara.split('\n').every((l) => /^[A-Za-z][\w-]*: /.test(l));
  fs.writeFileSync(msgFile, `${head}${isTrailers && head.includes('\n\n') ? '\n' : '\n\n'}Feature: ${feature}\n${tail}`);
  return true;
}
