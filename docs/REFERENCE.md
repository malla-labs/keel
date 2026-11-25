# keel reference

Everything keel does, by part. For how to use it day to day, read [GUIDE.md](GUIDE.md).

- [Skills](#skills)
- [Agents](#agents)
- [Hooks](#hooks)
- [CLI](#cli)
- [project.json](#projectjson)
- [Files and formats](#files-and-formats)
- [What `keel check` checks](#what-keel-check-checks)
- [What the guard blocks](#what-the-guard-blocks)
- [Exit codes](#exit-codes)

---

## Skills

| Skill | Use it when | What it does |
|---|---|---|
| `/keel:init [light\|full]` | Setting keel up in a repository | Reads the repo, asks mode, areas and owner, runs `keel init`, then `/keel:adopt` (existing code) or registers your brief (new project), offers the git hooks |
| `/keel:adopt [folder]` | Teaching keel an existing project | `keel scan`, reads docs, subagents per area on large repos, one confirmation, then summary, features, checks linked to existing tests, rules as proposed records, questions; `keel adopted`; baseline. Changes no code |
| `/keel:decide <rule>` | Someone states a rule, number, limit, policy or choice | Searches records and questions, says what changes, writes or supersedes the record with the quote, opens questions for gaps, runs `keel check` |
| `/keel:ask <what is blocked>` | A product answer is needed | Answers engineering questions itself; stores product questions in the pattern; builds the reversible default |
| `/keel:answer <Q> <answer>` | The owner answers | Writes the decision if the answer is a rule, files the answer, adds work to the feature |
| `/keel:state [feature]` | "Where are we?", "how far along?", "what's next?" | `keel progress` output, what blocks each feature in progress, open work |
| `/keel:feature <id> [what]` | Building or changing a feature | Register, checks, decisions, scope, one test per check, verify, review, close |
| `/keel:verify [quick\|full]` | Before saying "done", a commit or a PR | `keel check --changed`, the verify commands, the app; a fix loop of at most three rounds; records `feature verified`; evidence |
| `/keel:review [quick\|deep] [base]` | Before a commit or PR | Fresh-context reviewers, a separate verifier, only confirmed findings |

Every skill that changes state ends with `keel check` and quotes its last line.

---

## Agents

| Agent | Tools | Model | Role |
|---|---|---|---|
| `keel:reviewer` | Read, Grep, Glob, Bash (read-only git and keel) | Sonnet | Reviews a diff through one lens: correctness, rules or regressions. Returns `path:line \| severity \| defect \| scenario \| fix`, at most 15 lines |
| `keel:verifier` | Read, Grep, Glob, Bash (read-only git and keel) | Sonnet | Tries to prove each finding wrong. Returns `CONFIRMED` or `REJECTED` per finding, with a reason at `path:line` |

---

## Hooks

Defined in `hooks/hooks.json`. Each runs `node "${CLAUDE_PLUGIN_ROOT}/bin/keel" hook <name>` and does nothing outside a keel project or on unreadable input.

| Event | Matcher | Command | Effect |
|---|---|---|---|
| SessionStart | `startup\|resume\|clear\|compact` | `hook brief` | Prints the brief as context |
| UserPromptSubmit | all | `hook prompt` | Prints a one-line decision reminder as context |
| PreToolUse | `Edit\|Write\|NotebookEdit\|Bash` | `hook guard` | Exit 2 with a reason blocks the call ([what it blocks](#what-the-guard-blocks)) |
| Stop | all | `hook stop` | Exit 2 keeps Claude working while `keel check --changed` fails ([gate](#gate)) |

---

## CLI

Run `keel help` for the summary. All commands work from any folder inside the project; they find the nearest `.keel/project.json` above.

Options take a value as the next argument or with `=` (`--area=S`). A repeated option becomes a list (only `--option` accepts that). Results print as JSON on stdout; errors print `keel: <message>` and a hint on stderr with exit code 1.

### `keel version` (or `--version`, `-v`)

Prints the installed keel version. The session brief's first line shows it too (`keel 0.6.1 · <project> · …`).

### `keel rules [rules|questions|briefing]`

Prints keel's working rules, the question pattern, or the subagent brief template. Skills run these instead of reading plugin files, so no file-read permission is needed.

### `keel init [--name N] [--mode full|light] [--pattern P]`

Creates `.keel/` and the docs skeleton in the current folder. Never overwrites a file. Fails if `.keel/project.json` exists.

### `keel decision …`

| Command | Effect |
|---|---|
| `decision next <AREA>` | Prints the next id of an area: the highest existing number plus one, padded to 3 digits |
| `decision new …` | Writes a new record (options below) |
| `decision accept <ID> --by WHO [--quote TEXT]` | Moves a `proposed` record to `accepted`. A product record needs an owner and a quote |
| `decision list [--area A] [--status S]` | One line per record: id, status, kind, title |

`decision new` options:

| Option | Required | Rule |
|---|---|---|
| `--area` | yes | A configured area letter |
| `--title` | yes | The rule as one sentence, 8 characters or more, one line |
| `--kind` | yes | `product` or `engineering` |
| `--by` | yes | Who stated or proposed it |
| `--decision` | yes | The rule, exactly, with every number and its unit |
| `--status` | no | `proposed` (default) or `accepted`. An accepted product rule needs `--by` in `owners` and `--quote` |
| `--quote` | for accepted product | The owner's words. Written first under Why as `The owner, <date>: "<words>"` |
| `--why`, `--context`, `--consequences`, `--alternatives`, `--code`, `--flows` | no | Section bodies. No Why and no quote gives `Unknown. Needs the owner's answer: …` |
| `--supersedes <ID>` | no | The old record's status becomes `superseded by <new ID> (<by>, <date>)`; the new record's Context starts with `Replaces <ID>`. A record already superseded cannot be superseded again |

### `keel question …`

| Command | Effect |
|---|---|
| `question add …` | Validates against the pattern, numbers it (never reused), stores it, renders `OPEN_QUESTIONS.md` and the state |
| `question answer <Q> --answer A\|TEXT --by WHO [--quote] [--decision ID] [--work TEXT]` | Product questions need an owner. A letter expands to the option's text. Files a row in `RESOLUTIONS_<date>.md`; `--work` adds an item to the question's feature |
| `question withdraw <Q> --reason WHY --by WHO` | Removes a question that is no longer needed or is replaced; files it as withdrawn |
| `question list [--kind K]` | Prints open questions in the pattern |

`question add` options: `--kind`, `--question`, `--blocks`, `--option` (2 to 4, mark the recommended one with a leading `*`; typed labels such as `A)` are removed), `--default`, `--feature`, `--decision`, or all of it as `--json '{"kind":…,"options":["*…","…"]}'`.

### `keel feature …`

| Command | Effect |
|---|---|
| `feature add <ID> --title T [--status S] [--files GLOBS]` | Ids are lowercase words joined by dots (`booking.cancel`). Status: `planned` (default), `building`, `built`, `mocked`, `dropped` |
| `feature check <ID> --add TEXT` | Adds a numbered check. Numbers are never reused |
| `feature set <ID> [--status] [--title] [--files --reason] [--decision IDS] [--remove-check N] [--done-work N]` | `--files` and `--decision` add to the lists; adding files to a feature that already has some needs `--reason` and is logged as `feature.files`. `--status built` is refused until every check has a test, the verification is current, and each of the feature's decisions is cited (`Decision: <ID>`) in its code |
| `feature list` / `feature show <ID>` | List, or one feature as JSON |

### Linking existing tests

`keel feature check <ID> --add TEXT --test 'FILE::TEST NAME'` adds a check already proved by a test, without editing the test. `keel feature check <ID> --link N --test 'FILE::TEST NAME'` links one to an existing check. The file must exist and contain the name exactly. Linked tests count as coverage; `check` fails when a linked test is renamed or removed.

### `keel scan`

Prints facts about the repository as JSON: file count, languages by file count, manifests, their `test`/`e2e`/`verify`/`check`/`lint`/`typecheck`/`dev`/`build` scripts, test files per folder, the code layout (top 40 folders), docs (README, CLAUDE.md, AGENTS.md, architecture, overview, state, roadmap, spec, PRD, decisions, ADRs and everything under `docs/`) and decision folders.

### `keel summary set --file F | --text T`

Writes the project summary between `<!-- keel:summary -->` markers in the state file (adding a "The project" section if missing). 40 characters to 40 lines. `keel brief` prints its first 15 lines at the start of every session.

### `keel adopted`

Marks the end of an adoption in the history. The weekly table counts only what happens after it.

### `keel githooks install|uninstall|status`

Installs `pre-commit` (`keel hook git pre-commit`: `check --changed`), `commit-msg` (adds `Feature: <id>` when a scope is active) and `pre-push` (`check`, then `verify.quick`) into `core.hooksPath` or `.git/hooks`. Each is a marked block placed first in the hook file, so an existing hook's `exit 0` cannot skip it; uninstall removes only the block and deletes a file left empty. The block finds `keel` on PATH, else the CLI that installed it; without either it prints a note and lets git go on. `gate` decides: `enforce` blocks (exit 1), `observe` prints, `off` skips.

### `keel feature verified <ID> --command CMD`

Records that the feature's verification passed: the command, the time and a fingerprint of the contents of the files matching the feature's globs. Refused while any check has no test or `keel check` has errors. When the fingerprint no longer matches, the feature shows as `stale`.

### `keel progress [FEATURE] [--json]`

| Part | How it is computed |
|---|---|
| Feature percent | 80 × checks with a test / checks, + 10 if verified and not stale, + 10 if `built` |
| Overall | The mean of the features' percents, `dropped` excluded |
| Checks with a test | Checks cited by at least one `Covers:` in a test file |
| Scope | The active feature, when its scope started, files changed (git) inside the scope's globs, widenings |
| Weekly | Per ISO week from the history log: features moved to `built`, checks added, decisions written, questions answered (the last 6 weeks) |

`--json` gives all of it, plus the 8 most recent events.

### History log

`.keel/history.jsonl`, one JSON event per line, written by the CLI only: `decision.new`, `decision.accept`, `question.add`, `question.answer`, `question.withdraw`, `feature.add`, `feature.check`, `feature.status` (with `from` and `to`), `feature.verified`, `feature.link`, `summary.set`, `adopt.done`, `githooks.install`, `scope.start`, `scope.widen` (with the reason), `scope.deps`, `scope.clear`. Each has `at` (ISO time) and the ids involved.

### `keel scope …`

| Command | Effect |
|---|---|
| `scope start <FEATURE> [--files GLOBS]` | Locks edits to the feature's globs plus `alwaysInScope` |
| `scope widen <GLOB> --reason WHY` | Adds a glob, recording the reason |
| `scope deps <DECISION>` | Allows dependency changes, tied to an existing record. Works without a feature scope |
| `scope clear` / `scope show` | End the scope, or print it |

### `keel check [--changed] [--strict] [--json]`

Checks the whole project ([what](#what-keel-check-checks)). `--changed` limits code and test checks to files git reports as changed or untracked. `--strict` turns warnings into errors. Exit 1 on any error.

### `keel baseline`

Runs `check`, records every current error in `.keel/baseline.json` (by file and a hash of message plus line text, with counts), and from then on `check` skips those. Rerun it to shrink the baseline after fixing old errors.

### `keel render`, `keel brief`

`render` regenerates `OPEN_QUESTIONS.md` and the state block. `brief` prints the session summary.

### `keel hook guard|brief|prompt|stop`

For hooks only. Reads the Claude Code event as JSON on stdin.

---

## project.json

Only people edit `.keel/project.json`; the guard blocks Claude. Missing keys take these defaults.

| Key | Default | Meaning |
|---|---|---|
| `name` | folder name | Shown in the brief |
| `mode` | `full` | `light` disables the scope guard, the dependency guard and the stop gate |
| `decisions` | `docs/decisions` | Folder of records, questions and resolutions |
| `state` | `docs/STATE.md` | State file holding the generated block |
| `areas` | `P` platform, `D` product | `{ "<LETTER>": { "folder": "…", "about": "…" } }`. Order matters: ask about the first area first |
| `legacyBelow` | `{}` | Per area, records up to this number may lack `Status:` and `Kind:` lines |
| `owners` | `["owner"]` | Names that may accept product rules and answer product questions |
| `sessionOwner` | `false` | `true` when the person working in Claude sessions is the owner (solo projects): product rules they state are accepted. `false` (team projects): they stay `proposed` unless the person says in the session that they are the owner. The brief states which |
| `ownerDecides` | money, legal, user promises, limit numbers | Shown when the kind is wrong |
| `code` | common source extensions | Globs scanned for `Decision:` citations |
| `tests.files` | `*.test.*`, `*.spec.*`, `*Test.kt`, `*Tests.swift`, `test_*.py`, `*_test.go` | Globs of test files |
| `tests.require` | `case` | `case`: every test case cites; `file`: one citation per file; `off` |
| `ignore` | build output, dependencies, `.keel`, `.claude` | Globs never scanned |
| `manifests` | package and lock files of npm, Gradle, SwiftPM, CocoaPods, Python, Go, Cargo, Ruby, PHP | Files whose edit needs `scope deps` |
| `alwaysInScope` | `docs/**`, `.keel/**` | Always editable during a scope |
| `gate` | `enforce` | `enforce`, `observe` (log to `.keel/gate.log`) or `off` |
| `gateMaxBlocks` | `2` | Stop-gate blocks per session before it lets Claude stop and report |
| `verify.quick`, `verify.full`, `verify.app` | `null` | Commands the verify skill runs |
| `pattern`, `stacks` | `null`, `[]` | Recorded for pattern packs; not used yet |

Globs support `**`, `*`, `?` and `{a,b}`.

---

## Files and formats

### Decision record

`docs/decisions/<folder>/<ID>-<slug>.md` (the same layout many ADR setups use):

```markdown
# S-001: Renters get half back when cancelling 24 to 48 hours before pickup

Status: accepted (owner, 2026-11-25)
Kind: product

## Context
## Decision
## Why
## Alternatives rejected
## Consequences
## Code
## Flows
## Revision
```

Status values: `proposed (<who>, <date>)`, `accepted (<who>, <date>)`, `superseded by <ID>` with an optional `(<who>, <date>)`. The "who" part may contain commas. A record's rule is never edited after acceptance: supersede it.

### questions.json

```json
{ "lastId": 12, "open": [ { "id": 12, "kind": "product", "question": "…?", "blocks": "…",
  "options": [ { "key": "A", "text": "…", "recommended": true }, { "key": "B", "text": "…" } ],
  "default": "…", "feature": "booking.cancel", "decision": "S-001", "asked": "2026-11-25" } ] }
```

### features.json

```json
{ "booking.cancel": { "title": "Cancel a booking", "status": "building", "decisions": ["S-001"],
  "checks": { "1": "More than 48h before pickup refunds 100%" }, "lastCheck": 1,
  "files": ["src/bookings/**"], "work": [ { "text": "…", "from": "Q-12", "added": "2026-11-25" } ],
  "added": "2026-11-25" } }
```

### State block

`keel render`, `keel check` and every changing command rewrite the text between `<!-- keel:state -->` and `<!-- /keel:state -->` in the state file: the overall progress, a features table (status, progress bar, checks with a test, verified, open work, decisions), work from answers, and what waits for the owner. Everything outside the markers is yours.

---

## What `keel check` checks

| Area | Error | Warning |
|---|---|---|
| Records | File name and title ids differ; id in the wrong area folder; duplicate id; bad or missing `Status:`/`Kind:` (unless legacy); superseded by a missing record; a superseding record that never names the old one | |
| Questions | Missing parts of the pattern; wrong option keys; not exactly one recommended; unknown feature or decision; number above `lastId`; duplicate numbers; `OPEN_QUESTIONS.md` out of date | |
| Features | Bad id or status; no title; a cited decision that does not exist | |
| State | — (the generated block is refreshed in place, so progress stays current) | |
| Code | `Decision: <ID>` that does not exist, or a proposed product rule | Cites a superseded rule |
| Tests | A case that cites nothing (by `tests.require`); `Covers:` naming a missing feature, check or decision | A check of a `building`/`built` feature with no test, or more than one |

---

## What the guard blocks

| Call | Blocked when | In light mode |
|---|---|---|
| Edit/Write of `OPEN_QUESTIONS.md` | Always: it is generated | Blocked |
| Edit/Write of `.keel/questions.json`, `features.json`, `scope.json`, `baseline.json`, `history.jsonl` | Always: CLI only | Blocked |
| Edit/Write of `.keel/project.json` | Always: a change cannot edit its own checks | Blocked |
| Bash writing to those `.keel` files (`>`, `tee`, `sed -i`, `rm`, `mv`, `cp`, `truncate`) | Always | Blocked |
| Edit/Write of a manifest file | No `scope deps` decision. For `package.json`, only when a dependency field (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`) changes; scripts are free | Allowed |
| Bash `npm/pnpm/yarn/bun add\|install <pkg>`, `pip install`, `poetry add`, `uv add`, `cargo add`, `go get`, `gem install`, `bundle add`, `composer require`, `pod install` | No `scope deps` decision | Allowed |
| Edit/Write of a code file (`code` globs) with no feature in progress | Always in full mode: code belongs to a feature | Allowed |
| Edit/Write outside the scope | A scope is active and the path matches neither its globs nor `alwaysInScope` | Allowed |
| Bash that writes a file (`>`, `>>`, `tee`, `sed -i`, `cp`, `mv`, after a leading `cd`) | The written file would be blocked as an Edit. Text inside quotes and heredoc bodies is ignored | Allowed |
| Bash `git commit`/`git push` with `--no-verify` or `-n` | Always: only a person may skip a git hook | Allowed |

Paths outside the project are never blocked.

---

## Gate

On Stop, with `mode: full` and `gate: enforce`, keel runs `check --changed`:

- no errors: Claude stops;
- errors, fewer than `gateMaxBlocks` blocks so far in this session: exit 2, and the errors go back to Claude;
- limit reached: Claude may stop, and is told to report what still fails.

A Stop event already caused by a block (`stop_hook_active`) is never blocked again, so the gate cannot loop.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success; for hooks, allow |
| 1 | A keel error (bad input, a rule refused, `check` found errors) |
| 2 | Hooks only: block the tool call, or keep Claude working |
