import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fail } from './util.mjs';

// ---------- Who is in the session ----------

/** "Ana Ruiz <ana@x.io>" → { name, email }; "Ana Ruiz" → { name, email: null }. */
export function parseOwner(entry) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(entry));
  return m ? { name: m[1], email: m[2].toLowerCase() } : { name: String(entry).trim(), email: null };
}

export function ownerNames(cfg) {
  return cfg.owners.map((o) => parseOwner(o).name);
}

/** The git identity of whoever runs keel: the committer, as git would record it. Null when git has none. */
export function gitIdentity(root) {
  try {
    const ident = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /^(.*?) <([^>]*)>/.exec(ident);
    return m ? { name: m[1], email: m[2].toLowerCase() } : null;
  } catch {
    return null;
  }
}

/**
 * Whether the person in this session is an owner. When owners carry an email ("Name <email>"),
 * the git identity decides, so a committed `sessionOwner: true` cannot make every teammate an owner.
 * Without emails (a solo project), `sessionOwner` decides, as before.
 */
export function sessionOwner(project) {
  const owners = project.cfg.owners.map(parseOwner);
  if (owners.some((o) => o.email)) {
    const me = gitIdentity(project.root);
    const hit = me && owners.find((o) => o.email === me.email);
    return hit ? { owner: hit.name, by: 'git identity' } : null;
  }
  return project.cfg.sessionOwner ? { owner: owners[0].name, by: 'sessionOwner' } : null;
}

/**
 * Refuses an owner-only act (accepting a product rule, answering a product question) unless `by`
 * names an owner and, on a team (owners with emails), the git identity is that owner.
 */
export function requireOwner(project, by, act) {
  const owners = project.cfg.owners.map(parseOwner);
  const named = owners.find((o) => o.name === by);
  if (!named) fail(`Only an owner (${owners.map((o) => o.name).join(', ')}) ${act}; "${by}" may only propose it.`, 'Write it with --status proposed and ask the owner with `keel question add`.');
  if (named.email) {
    const me = gitIdentity(project.root);
    if (!me || me.email !== named.email) {
      fail(`Only ${named.name} ${act}, and this session's git identity is ${me ? me.email : 'unknown'}, not ${named.email}.`, 'Record it as proposed; the owner accepts it from their own session (`keel decision accept` / `keel question answer`).');
    }
  }
}

// ---------- Who works on what ----------

/** The name keel records for the person holding a feature. */
export function holderName(project) {
  const me = gitIdentity(project.root);
  return me ? `${me.name} <${me.email}>` : 'unknown';
}

// ---------- Merges ----------

/**
 * Three-way merge of a keel JSON store, so two branches that both add a question, a check or a
 * module merge without conflict markers. Numbers that collide are renumbered on "theirs" side.
 * Returns the merged object and what was renumbered.
 */
export function mergeStore(kind, base, ours, theirs) {
  if (kind === 'questions' || kind === 'reviews') return mergeNumbered(kind, base, ours, theirs);
  if (kind === 'features') return mergeFeatures(base, ours, theirs);
  if (kind === 'architecture') return mergeArchitecture(base, ours, theirs);
  fail(`No merge for "${kind}".`);
}

function mergeNumbered(kind, base, ours, theirs) {
  const key = kind === 'questions' ? 'open' : 'findings';
  const B = base[key] ?? [];
  const O = ours[key] ?? [];
  const T = theirs[key] ?? [];
  const baseLast = base.lastId ?? 0;
  const ourLast = ours.lastId ?? 0;
  const byId = (list, id) => list.find((x) => x.id === id);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Numbers both branches took since the base name different items: theirs move above every used number.
  const renumbered = [];
  let next = Math.max(ourLast, theirs.lastId ?? 0);
  const theirNew = [...new Set([...T.map((x) => x.id), ...(theirs.closed ?? []).map((c) => c.id)])].filter((id) => id > baseLast).sort((a, b) => a - b);
  const map = new Map();
  for (const id of theirNew) if (id <= ourLast) { next += 1; map.set(id, next); renumbered.push({ from: id, to: next }); }
  const move = (x) => (map.has(x.id) ? { ...x, id: map.get(x.id) } : x);

  const items = [];
  for (const o of O) {
    if (o.id > baseLast) { items.push(o); continue; } // new on our side
    const t = byId(T, o.id);
    if (!t) continue; // closed or removed on their side
    items.push(same(o, byId(B, o.id)) ? t : o); // theirs wins only where ours left the base as it was
  }
  for (const t of T) if (t.id > baseLast) items.push(move(t)); // new on their side
  const merged = { ...ours, lastId: Math.max(next, ourLast, theirs.lastId ?? 0), [key]: items.sort((a, b) => a.id - b.id) };
  if (kind === 'questions') {
    const closed = [...(ours.closed ?? [])];
    for (const c of (theirs.closed ?? []).map(move)) if (!closed.some((x) => x.id === c.id)) closed.push(c);
    merged.closed = closed.sort((a, b) => a.id - b.id);
  }
  return { merged, renumbered };
}

function mergeFeatures(base, ours, theirs) {
  const merged = { ...ours };
  const renumbered = [];
  for (const [id, t] of Object.entries(theirs)) {
    const o = ours[id];
    const b = base[id];
    if (!o) { if (!b) merged[id] = t; continue; }
    if (JSON.stringify(t) === JSON.stringify(b)) continue;
    if (JSON.stringify(o) === JSON.stringify(b)) { merged[id] = t; continue; }
    // Both sides changed the feature: keep every check (renumbering theirs on a collision),
    // every decision, file and work item; a verification is dropped, so it must be done again.
    const f = { ...o, checks: { ...o.checks }, decisions: [...new Set([...(o.decisions ?? []), ...(t.decisions ?? [])])], files: [...new Set([...(o.files ?? []), ...(t.files ?? [])])] };
    let last = Math.max(o.lastCheck ?? 0, t.lastCheck ?? 0);
    for (const [n, text] of Object.entries(t.checks ?? {})) {
      if (b?.checks?.[n] !== undefined || Object.values(f.checks).includes(text)) continue;
      if (f.checks[n] === undefined) { f.checks[n] = text; continue; }
      last += 1;
      f.checks[String(last)] = text;
      renumbered.push({ from: `${id}#${n}`, to: `${id}#${last}` });
    }
    f.lastCheck = last;
    const work = [...(o.work ?? [])];
    for (const w of t.work ?? []) if (!work.some((x) => x.text === w.text)) work.push(w);
    f.work = work;
    if (JSON.stringify(o.verified) !== JSON.stringify(t.verified)) delete f.verified;
    merged[id] = f;
  }
  return { merged: Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]])), renumbered };
}

function mergeArchitecture(base, ours, theirs) {
  const modules = { ...(ours.modules ?? {}) };
  for (const [name, t] of Object.entries(theirs.modules ?? {})) {
    const o = modules[name];
    const b = base.modules?.[name];
    if (!o) { if (!b) modules[name] = t; continue; }
    if (JSON.stringify(o) === JSON.stringify(b)) { modules[name] = t; continue; }
    if (JSON.stringify(t) === JSON.stringify(b)) continue;
    modules[name] = {
      about: o.about,
      files: [...new Set([...o.files, ...t.files])],
      uses: [...new Set([...o.uses, ...t.uses])],
      decisions: [...new Set([...o.decisions, ...t.decisions])],
    };
  }
  return { merged: { modules: Object.fromEntries(Object.keys(modules).sort().map((k) => [k, modules[k]])) }, renumbered: [] };
}

/** The kind of store a path is, for the merge driver. */
export function storeKind(rel) {
  const name = path.basename(rel);
  return { 'questions.json': 'questions', 'reviews.json': 'reviews', 'features.json': 'features', 'architecture.json': 'architecture' }[name] ?? null;
}

/** git merge driver entry: merges %O %A %B into %A. Returns the renumbered items, for the message. */
export function runMergeDriver(rel, basePath, oursPath, theirsPath) {
  const kind = storeKind(rel);
  if (!kind) fail(`keel has no merge driver for ${rel}.`);
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; } };
  const { merged, renumbered } = mergeStore(kind, read(basePath), read(oursPath), read(theirsPath));
  fs.writeFileSync(oursPath, JSON.stringify(merged, null, 2) + '\n');
  return renumbered;
}
