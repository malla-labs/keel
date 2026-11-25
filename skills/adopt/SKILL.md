---
name: adopt
description: Teach keel an existing project - read the repository and its docs, then write the project summary every session reads, register the features that exist with their status, files and checks (linked to the tests already there), record the rules found as decisions, and ask the owner only what the code cannot tell. Changes no code. Use right after /keel:init on a project with code, or when the user says "adopt", "register this project", "teach keel this project", or "keel doesn't know my project".
argument-hint: "[folder to limit to]"
---

# Adopt an existing project

Run `keel rules` first and follow it. **Change no code and no test.** This skill only reads the repository and writes keel's records.

## 1. Read

1. `keel scan`: languages, manifests and test scripts, the folder layout, test files per folder, docs, decision folders. If it fails with "No keel project here", run `/keel:init` first.
2. Read the docs it lists that describe the whole project (README, CLAUDE.md or AGENTS.md, architecture, overview, state, roadmap). Skim; do not read every file.
3. **Large repository** (more than about 400 code files, or several apps): split the layout into 2 to 6 areas (one per app or top folder) and send one Explore subagent per area, in one message, model `sonnet`. Brief each one, as `keel rules briefing` says, to return at most 40 lines:
   - the user-facing features in its area: a proposed id (`area.action`, lowercase, dot-joined), one-line title, status (`built` = real code paths and tests; `mocked` = fixtures, fakes, TODO stubs; `planned` = only in docs), file globs;
   - for each built feature, up to 6 behaviours that an existing test proves, as `behaviour | test file::exact test name`;
   - rules it finds in code or docs, each with `path:line`: named constants and config defaults, validation limits (lengths, counts, ranges), status machines and allowed transitions, permission checks (who may do what), times and deadlines, prices and percentages, and comments that say why;
   - what it could not tell.
   Small repository: do this yourself.

## 2. Draft and confirm

4. Draft four lists: the **summary** (what the project is, for whom, the main parts, the stack, where to read more; at most 40 lines), the **features**, the **rules**, the **unknowns**.
5. If the user is present, show the draft (summary in full, features and rules as tables) and ask once: "Correct anything before I register it?" Apply their corrections. Do not ask feature by feature. If nobody is present, go on; everything you inferred stays `proposed`.

## 3. Register

6. Summary: write it to a file in the scratchpad and run `keel summary set --file <path>`.
7. Features, one at a time: `keel feature add <id> --title "…" --status built|mocked|planned --files "<globs>"`. Prefer 5 to 30 features that a user would recognise over one per file.
8. Checks:
   - built: `keel feature check <id> --add "<behaviour>" --test "<file>::<exact test name>"` (the test is linked, not edited; keel refuses a name the file does not contain, so copy it exactly);
   - planned or mocked: `keel feature check <id> --add "<behaviour>"` from the docs, without a test.
   Up to 6 checks per feature: the behaviours that matter, not every test.
9. Rules:
   - The project already has decision records in another folder: do not copy them. Tell the user to point `decisions` in `.keel/project.json` at that folder and set `legacyBelow`.
   - Look for rules actively (the list in step 3): a working project always has some. Record at most 15, those a user or a teammate would notice first.
   - A rule found in code or docs with no record: `keel decision new --area … --kind … --by lead --status proposed --title "…" --decision "…" --why "Found in <path:line>." --code "<path>"`. Never `accepted`, never a quote: the owner did not say it. Link it: `keel feature set <id> --decision <ID>`.
10. Unknowns that block a feature: `/keel:ask`, in the pattern, at most 5, the most blocking first. Unknowns that block nothing go in the summary's last line as "Not known yet: …".

## 4. Close

11. `keel adopted`, so the weekly pace does not count what already existed. Then `keel check`. If it fails only on old tests that cite nothing (`test cites nothing`), run `keel baseline` and say how many errors were baselined. Fix any other error.
12. Show `keel progress` in a code block, then at most 6 lines: features registered by status, checks linked, rules proposed (they need the owner: `keel decision accept <ID> --by <owner> --quote "…"`), questions asked, what to set in `.keel/project.json` (`owners`, `verify.quick`, `decisions`).
