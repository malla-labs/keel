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
  // On a team (any owner with an email), every owner is known by git identity: a name alone proves nothing.
  if (!named.email && owners.some((o) => o.email)) {
    fail(`${named.name} has no email in .keel/project.json owners, so keel cannot tell their session from anyone's.`, `The owner adds it: "${named.name} <their git email>".`);
  }
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
  return me ? `${me.name} <${me.email}>` : null;
}

/** Whether a recorded holder is the person in this session. A session with no git identity matches nobody. */
export function isHolder(project, holder) {
  const me = holderName(project);
  return Boolean(me && holder?.by === me);
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
  // Items are matched by their uid, which survives a renumber; items written before uids by their number.
  const k = (x) => (x.uid ? `u:${x.uid}` : `n:${x.id}`);
  const index = (list) => new Map((list ?? []).map((x) => [k(x), x]));
  const B = index(base[key]);
  const T = index(theirs[key]);
  const O = ours[key] ?? [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ourClosed = ours.closed ?? [];
  const ourCloseKeys = new Set(ourClosed.map(k));

  const items = [];
  for (const o of O) {
    if (!B.has(k(o))) { items.push(o); continue; } // new on our side
    const t = T.get(k(o));
    if (!t) continue; // closed or removed on their side
    items.push(same(o, B.get(k(o))) ? { ...t, id: o.id } : o); // theirs wins only where ours left the base as it was
  }

  // Their new items keep their number unless this branch used it; then they move above every used number.
  const used = new Set([...items.map((x) => x.id), ...ourClosed.map((c) => c.id)]);
  let next = Math.max(ours.lastId ?? 0, theirs.lastId ?? 0, ...used);
  const renumbered = [];
  const moved = new Map();
  const place = (x) => {
    if (moved.has(k(x))) return { ...x, id: moved.get(k(x)) };
    if (!used.has(x.id) && x.id > (base.lastId ?? 0) && x.id > (ours.lastId ?? 0)) { used.add(x.id); return x; }
    if (!used.has(x.id) && x.id <= (base.lastId ?? 0)) { used.add(x.id); return x; }
    next += 1;
    moved.set(k(x), next);
    renumbered.push({ from: x.id, to: next });
    used.add(next);
    return { ...x, id: next };
  };
  for (const t of theirs[key] ?? []) {
    if (B.has(k(t)) || ourCloseKeys.has(k(t)) || items.some((x) => k(x) === k(t))) continue;
    items.push(place(t));
  }
  const merged = { ...ours, lastId: Math.max(next, ours.lastId ?? 0, theirs.lastId ?? 0), [key]: items.sort((a, b) => a.id - b.id) };
  if (kind === 'questions') {
    const closed = [...ourClosed];
    for (const c of theirs.closed ?? []) {
      if (closed.some((x) => k(x) === k(c))) continue;
      closed.push(B.has(k(c)) || !c.uid ? c : place(c));
    }
    merged.closed = closed.sort((a, b) => a.id - b.id);
  }
  return { merged, renumbered };
}

function mergeFeatures(base, ours, theirs) {
  const merged = { ...ours };
  const renumbered = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [id, t] of Object.entries(theirs)) {
    const o = ours[id];
    const b = base[id];
    if (!o) { if (!b) merged[id] = t; continue; }
    if (same(t, b)) continue;
    if (same(o, b)) { merged[id] = t; continue; }
    // Both sides changed it: merge field by field. A field only one side changed takes that side's value.
    const f = {};
    for (const field of new Set([...Object.keys(o), ...Object.keys(t)])) {
      if (same(o[field], b?.[field])) { if (t[field] !== undefined) f[field] = t[field]; }
      else f[field] = o[field];
    }
    // Lists and maps both sides added to are joined.
    f.decisions = [...new Set([...(o.decisions ?? []), ...(t.decisions ?? [])])];
    f.files = [...new Set([...(o.files ?? []), ...(t.files ?? [])])];
    const work = [...(o.work ?? [])];
    for (const w of t.work ?? []) if (!work.some((x) => x.text === w.text)) work.push(w);
    f.work = work;
    f.checks = { ...o.checks };
    f.links = { ...(o.links ?? {}) };
    let last = Math.max(o.lastCheck ?? 0, t.lastCheck ?? 0);
    for (const [n, text] of Object.entries(t.checks ?? {})) {
      if (b?.checks?.[n] !== undefined || Object.values(f.checks).includes(text)) continue;
      let at = n;
      if (f.checks[n] !== undefined) {
        last += 1;
        at = String(last);
        renumbered.push({ from: `${id}#${n}`, to: `${id}#${at}` });
      }
      f.checks[at] = text;
      if (t.links?.[n]) f.links[at] = t.links[n];
    }
    for (const [n, link] of Object.entries(t.links ?? {})) if (!(n in f.links) && f.checks[n] === t.checks?.[n]) f.links[n] = link;
    if (!Object.keys(f.links).length) delete f.links;
    f.lastCheck = last;
    // A verification both sides changed is no longer the proof of the merged code: verify again.
    if (!same(o.verified, b?.verified) && !same(t.verified, b?.verified) && !same(o.verified, t.verified)) delete f.verified;
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
  // Only a missing or empty side is "nothing"; unreadable JSON stops the merge, so git reports a conflict
  // instead of reading it as "every item was removed".
  const read = (p) => {
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (!text.trim()) return {};
    try { return JSON.parse(text); } catch (e) { fail(`${rel}: one side is not valid JSON (${e.message}); resolve this file by hand with \`keel\` commands after the merge.`); }
  };
  const { merged, renumbered } = mergeStore(kind, read(basePath), read(oursPath), read(theirsPath));
  fs.writeFileSync(oursPath, JSON.stringify(merged, null, 2) + '\n');
  return renumbered;
}
