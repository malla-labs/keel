# Using keel

keel is a Claude Code plugin that makes AI work on a project predictable. It does five things:

1. **Decisions before code.** When you state a rule, Claude writes it as a numbered decision record, with your words quoted, before building anything.
2. **One pattern for questions.** When Claude needs a product answer from you, it asks in one fixed shape: one question, why it blocks, 2 to 4 options with one recommended, and the default it builds meanwhile.
3. **One feature at a time.** Work is locked to the files of one feature. Edits outside them are blocked until the scope is widened with a reason.
4. **Targeted tests.** Each feature has numbered checks. Each check gets exactly one test, and that test cites it (`Covers: booking.cancel#2`). A test that cites nothing fails.
5. **Done means proven.** Claude cannot end its turn while `keel check` fails on the changed files, and it must show the commands it ran and their output.

The rules live in a command-line tool (`keel`), not only in instructions, so they hold even when the model forgets them.

---

## 1. Install

```bash
claude plugin marketplace add malla-labs/keel
claude plugin install keel@keel
```

Start a new Claude Code session. The plugin adds the `/keel:*` skills, two review agents, four hooks, and the `keel` command to the Bash tool's PATH. It needs Node 20 or later.

To update to a newer release:

```bash
claude plugin marketplace update keel
claude plugin update keel@keel
```

Then restart Claude Code.

To use `keel` in your own terminal too, clone the repository and link the CLI once: `git clone https://github.com/malla-labs/keel && ln -s "$PWD/keel/bin/keel" /usr/local/bin/keel`.

---

## 2. Set up a project

In the repository, ask Claude:

```
/keel:init
```

Claude looks at the repository, asks you three things (mode, decision areas, owner name) and runs `keel init`. You get:

| Path | What it is | Who writes it |
|---|---|---|
| `.keel/project.json` | The rules: areas, owners, test patterns, gate mode, verify commands | You only. Claude is blocked from editing it |
| `.keel/features.json` | Features, their checks, their open work | The `keel` CLI |
| `.keel/questions.json` | Open questions | The `keel` CLI |
| `.keel/scope.json` | The active scope (not committed) | The `keel` CLI |
| `docs/decisions/<area>/<ID>-<slug>.md` | Decision records | The `keel` CLI creates; people and Claude fill the sections |
| `docs/decisions/OPEN_QUESTIONS.md` | Open questions, readable | Generated. Never edit |
| `docs/decisions/RESOLUTIONS_<date>.md` | Answers given on a day | The `keel` CLI |
| `docs/STATE.md` | Where the project stands | You write around the generated block |

Then set the keys only you should set (see [REFERENCE.md](REFERENCE.md#projectjson)), at least:

```json
"owners": ["owner"],
"verify": { "quick": "pnpm test --changed", "full": "pnpm test", "app": null }
```

**Modes.** `full` turns on the scope guard, the dependency guard and the stop gate. `light` keeps decisions and questions but blocks nothing, which suits small or throwaway projects.

### Teaching keel the project

After `init`, keel's records are empty. Fill them once:

- **Existing code:** `/keel:adopt` (init runs it for you). Claude runs `keel scan` (languages, test scripts, layout, docs), reads the main docs, and, for a large repository, sends one subagent per app or area. It shows you a draft (summary, features, rules, unknowns), applies your corrections, then registers everything:
  - the **project summary** (at most 40 lines) in `docs/STATE.md`, which opens every session's brief;
  - the **features** that exist, with status `built`, `mocked` or `planned` and their files;
  - **checks linked to the tests that already exist**, without editing them (`--test "file::exact test name"`; keel refuses a name the file does not contain, and `check` fails if the test disappears later);
  - the **rules** found in code and docs, as `proposed` records citing `path:line`, for you to accept;
  - **questions** in the pattern for what the code cannot tell.
  It changes no code. It ends with `keel adopted`, so the weekly pace does not count what already existed.
- **New project:** give Claude the brief (what it is, for whom, the users, the features, the rules you know, the stack, what is undecided) and say "register this in keel".

### Adopting keel in an existing project: old tests

Old code will not meet the rules, for example thousands of tests that cite nothing. Record what exists today so only new problems fail:

```bash
keel check       # see what fails
keel baseline    # accept today's errors
keel check       # OK: 0 errors, ... N baselined
```

The baseline matches errors by file and line text, not line number, so moving code does not break it. A new uncited test still fails. If records older than the status-line rule have no `Status:` line, set `legacyBelow` (for example `{ "P": 548 }`) instead of editing them.

---

## 3. Daily use

You mostly talk to Claude normally. The skills start on their own when what you say fits them, and you can also call them by name.

### You state a rule → `/keel:decide`

> "Renters who cancel 24 to 48 hours before pickup get 50% back."

Claude searches existing records and questions, tells you what this changes or contradicts, and writes `S-001` with your words quoted, status `accepted`, kind `product`. If your rule leaves a case open (what about under 24 hours?), Claude does not guess. It opens a question in the pattern and notes `Open: Q-1` in the record.

Who decides what:

| Kind | Examples | Who accepts it |
|---|---|---|
| Engineering | Structure, libraries, how a rule is built | Claude or an engineer (`--by lead`) |
| Product | Money, legal, limits, timings, anything a user sees as a promise | Only an owner from `owners` |

A product rule that Claude proposes stays `proposed`. Code that cites a proposed product rule fails `keel check`.

### Claude needs an answer → `/keel:ask`

Engineering questions Claude answers itself and records. Product questions come to you like this:

```
Q-12 · product · booking.cancel
Question: What refund does a renter get when cancelling under 24 hours before pickup?
Why it blocks: check booking.cancel#3 needs the number.
Options:
  A) No refund (recommended)
  B) 25% refund
  C) Full refund minus the service fee
Default if no answer: A, as a settings value an admin can change.
```

The CLI refuses a question with two `?`, one that joins a second question ("…, and does…"), no reason it blocks, no recommendation or no default. Claude builds the reversible default while it waits.

### You answer → `/keel:answer`

> "Q-12: go with A."

The question leaves the open list and goes into today's `RESOLUTIONS_<date>.md` with your words. If the answer is a rule, a decision record is written first. Any code still to change becomes a work item on the feature and shows up in `docs/STATE.md`.

### You ask for a feature → `/keel:feature`

> "Build booking.cancel."

1. **Register:** `keel feature add booking.cancel --files "src/bookings/**"`.
2. **Checks first:** one sentence per behaviour (`booking.cancel#1 … #4`). Claude shows you the list before building.
3. **Decisions:** missing rules are decided or asked.
4. **Scope lock:** `keel scope start booking.cancel`. From now on an edit outside `src/bookings/**`, `docs/**` and `.keel/**` is blocked. In full mode, code cannot change at all while no feature is in progress, so every change, even a one-line fix, goes through a feature.
5. **Build:** for each check, one test that cites it, red, then green.
6. **Close:** `/keel:verify`, `/keel:review`, status `built`, scope cleared. keel refuses `built` until every check has a test, the verification is current and the code cites each of the feature's decisions.

When the work truly needs another path, Claude widens the scope with a reason you can read later:

```bash
keel scope widen 'src/payments/**' --reason 'refund calls the payment port'
```

A new dependency needs an engineering decision first, then `keel scope deps P-014`. Until then `package.json` and `pnpm add …` are blocked.

### Proving it works → `/keel:verify`

Claude runs `keel check --changed`, then `verify.quick` (or the tests for the changed checks), then the app for visible changes. It reports each command and its last lines. It never skips a test, adds a sleep or a retry, or edits a check to make it pass. After three failed rounds on the same problem it stops and asks you.

### Reviewing → `/keel:review`

Two read-only reviewer agents start in fresh contexts that never saw why the code was written. One looks for correctness bugs, the other for broken rules: decisions, checks, uncited tests, scope creep. A separate verifier agent tries to prove each finding wrong, and only confirmed findings come back, tagged `important`, `nit` or `pre-existing`. `/keel:review deep` adds a regressions reviewer and three verifiers that vote. After three rounds with important findings still open, Claude asks you to reconsider the approach.

In a test with two planted bugs (a boundary changed from "more than 48h" to "48h or more", and an amount passed in dollars to a function taking cents) and an unplanned function outside the feature, the review reported all three as important, and the verifier rejected the one false finding.

### Where are we, how far along → `/keel:state` or `keel progress`

```
Overall ███░░░░░░░ 30%  ·  checks with a test 4/5
Features: 2 planned, 1 building

booking.cancel             building █████████░  90%  4/4 checks  · verified · waits on Q-1
payments.refund            planned  ░░░░░░░░░░   0%  0/1 checks
search.cars                planned  ░░░░░░░░░░   0%  0/0 checks

Scope: booking.cancel since 2026-11-25 · 2 files changed in scope · widened 0×

Week      built  checks  decisions  answers
2026-W48      1       5          2        1
```

Progress is computed, never estimated: **80%** for the share of checks that have a test, **+10%** for a verification that is still current, **+10%** for status `built`. A feature is verified with `keel feature verified <id> --command "<what passed>"`, which keel refuses while a check has no test or `keel check` fails. The verification turns **stale** by itself when any file of the feature changes afterwards.

`keel progress <id>` shows one feature and lists its checks without a test. The scope line shows how long the current feature has been in progress, how many files changed inside its scope and how often it was widened. The weekly table comes from `.keel/history.jsonl`, an append-only log of every change keel makes (commit it: it is the team's history).

The same numbers appear as a table in the generated block of `docs/STATE.md`, which `keel check` refreshes, so the stop gate keeps it current at the end of every turn.

---

## 4. What runs on its own

| Hook | When | What it does |
|---|---|---|
| Brief | Session start, resume, `/clear`, after compaction | Gives Claude a 5-line summary: features, open questions, active scope, the rules |
| Prompt reminder | Every message you send | One line: if you stated a rule or answer, decide or answer before building |
| Guard | Before every Edit, Write, NotebookEdit and Bash call | Blocks edits outside the scope, dependency changes without a decision, hand edits of keel's files and of `.keel/project.json` |
| Stop gate | When Claude tries to finish | Runs `keel check --changed`. If it fails, Claude must fix it or explain. It blocks at most `gateMaxBlocks` times (default 2) per session, then lets Claude stop and say what still fails |

Outside a keel project every hook does nothing.

**Gate modes** (`gate` in `project.json`): `enforce` blocks, `observe` only writes what it would have blocked to `.keel/gate.log` (use it for a week when adopting), `off` disables the stop gate.

---

## 5. Git hooks

Claude Code hooks only run inside Claude. Git hooks keep the same rules for you, your teammates and any other tool:

```bash
keel githooks install      # or say yes when /keel:init asks
```

| Git hook | Does | Blocks |
|---|---|---|
| `pre-commit` | `keel check --changed` | In `enforce` |
| `commit-msg` | Adds `Feature: <id>` when a scope is active, so every commit is traced to its feature | Never |
| `pre-push` | `keel check`, then `verify.quick` | In `enforce` |

`gate: observe` prints what would be blocked and lets git go on; `off` skips the checks. Installing never overwrites a hook you already have (husky, lefthook, your own scripts): keel adds a marked block at the top, and `keel githooks uninstall` removes only that block. A machine without keel gets a one-line note, never a blocked commit. People may still use `--no-verify`; Claude may not, the guard blocks it. `keel githooks status` shows what is installed.

## 6. Writing tests the keel way

Each test cites the check or decision it proves, in its name or in a comment on one of the three lines above it:

```js
// Covers: booking.cancel#2
test('24 to 48h before pickup refunds 50%', () => { … });

test('Covers: booking.cancel#1 S-001 - more than 48h refunds 100%', () => { … });
```

```kotlin
// Covers: booking.cancel#2
@Test fun refundsHalfBetween24And48Hours() { … }
```

`keel check` reports:

- **error:** a test that cites nothing, or cites a check or decision that does not exist;
- **warning:** a check of a `building` or `built` feature with no test, or with more than one test. `--strict` turns these into errors.

Recognised test cases: `it(` / `test(` (JS, TS), `@Test` (Kotlin, Java, Swift Testing), `func test…` (XCTest), `def test_…` (pytest), `func Test…(t *testing.T)` (Go). Set `tests.require` to `file` for one citation per file, or `off`.

---

## 7. Citing decisions in code

Code that implements a rule names it:

```ts
// Decision: S-048
```

`keel check` fails when the id does not exist, or when it is a product rule the owner has not accepted. It warns when the rule is superseded.

---

## 8. A day with keel

```
you:    The owner says: protection is mandatory and the renter picks the plan.
claude: /keel:decide → S-050 accepted, quoted. It contradicts nothing; it answers Q-5.
        Q-5 filed in RESOLUTIONS_2026-11-25.md. Work added to checkout.protection.

you:    Build checkout.protection.
claude: /keel:feature → 3 checks. One question for you (Q-13, pattern). Building default A.
        Scope locked to apps/web/app/modules/checkout/**.
        … 3 tests, each Covers: checkout.protection#n …
        /keel:verify → keel check OK; pnpm test: 3 passed.
        /keel:review → 1 important finding confirmed, fixed. Feature built.

you:    Q-13: B.
claude: /keel:answer → filed. B differs from the default: 1 work item, building it now.
```

---

## 9. Limits

- The guard sees Edit, Write, NotebookEdit and Bash commands. A Bash command can still write a file outside the scope (`sed -i`, a script). The guard catches dependency installs and writes to keel's own files; review and the stop gate catch the rest.
- Wording rules for questions (one `?`, no joined second question) are checked when a question is added, not on old questions.
- `verify.*` commands are run by Claude through the verify skill, not by the CLI.
- `pattern` and `stacks` are recorded but not used yet; pattern packs (hexagonal first) are the next step.

The full list of commands, options, configuration keys and checks is in [REFERENCE.md](REFERENCE.md).
