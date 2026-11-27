# keel

**A Claude Code plugin that keeps AI work on a project stable.** Rules become decision records before code. Product questions reach the owner in one fixed pattern. Work stays inside one feature's files. Every test cites the behaviour it proves. Nothing is "done" until it is proven.

The rules live in a small command-line tool and in hooks, not only in instructions, so they hold even when the model forgets them.

## What it does

| | |
|---|---|
| **Decisions before code** | When you state a rule ("refunds are 50% between 24 and 48 hours"), Claude writes a numbered decision record with your words quoted, checks it against earlier records, and supersedes what it replaces |
| **One pattern for questions** | Product questions come as: one question, why it blocks, 2 to 4 options with one recommended, and the reversible default built meanwhile. Engineering questions Claude answers itself |
| **No code without a feature** | Code changes belong to a registered feature. The guard blocks edits outside the feature's files, dependency changes without a decision, and edits to keel's own records |
| **Targeted tests** | Each feature has numbered checks; each check gets one test that cites it (`Covers: booking.cancel#2`). An uncited test fails |
| **Architecture as records** | Init settles the stack and the modules with the owner, even in auto mode. Each module says what it may import, backed by a decision; `keel check` fails on an import across a boundary, and `docs/ARCHITECTURE.md` is generated |
| **Quality gate** | `keel verify` runs your tests, lint and type check; `feature verified --run` records what keel itself ran. Review depth follows each feature's risk: quality for every change, security for sign-in, payments and anything strangers reach |
| **Proven, not claimed** | "Built" is refused until every check has a test, a verification is recorded and still current, and the code cites its decisions. A stop gate keeps Claude working while `keel check` fails |
| **Fresh-eyes review** | Reviewers that never saw the reasoning look for bugs and broken rules; a separate verifier confirms each finding. Findings are numbered records (`R-n`), and an open important one blocks "built" |
| **Progress you can trust** | Per feature, per scope and per week, computed from the files: tests, verifications, history |
| **Teams** | Owners are known by their git identity, so a teammate's session cannot accept product rules. keel's records merge as data across branches (colliding numbers are renumbered), each feature shows who holds it, and `keel ci github` runs the same checks on every pull request |
| **Git hooks** | The same checks for people and other tools: pre-commit, commit-msg (adds the feature), pre-push |

## Install

```bash
claude plugin marketplace add malla-labs/keel
claude plugin install keel@keel
```

Restart Claude Code. Requires Node 20 or later. Check the version with `claude plugin list`, or `keel version` from a Claude session.

## Quick start

In a repository, in Claude Code:

```
/keel:init
```

- **Existing code:** init runs `/keel:adopt`, which reads the repository and registers the project summary, the features (with checks linked to the tests already there), the rules it finds as proposed decisions, and questions for what the code cannot tell. It changes no code.
- **New project:** give Claude a short brief (what it is, for whom, the features, the rules you know, the stack, what is undecided) and say "register this in keel".

Then set the two keys only you may set in `.keel/project.json`: `owners` (and `sessionOwner: true` if you, the person in the sessions, are the owner) and `verify.quick` (your fast test command). Optionally: `keel githooks install`.

## Day to day

| When | Do |
|---|---|
| Start of the day | `/keel:state`: progress, what is blocked, what waits for you |
| Build or change something | `/keel:feature <feature.id> <what it should do>` |
| You state a rule | Just say it; `/keel:decide` records it before any code |
| Claude asks Q-n | Reply "Q-3: B"; `/keel:answer` files it |
| Before a commit or PR | `/keel:review` |

```
Overall ███░░░░░░░ 30%  ·  checks with a test 4/5

booking.cancel     building █████████░  90%  4/4 checks  · verified · waits on Q-1
payments.refund    planned  ░░░░░░░░░░   0%  0/1 checks

Scope: booking.cancel since 2026-11-25 · 2 files changed in scope · widened 0×
```

## Docs

- [docs/GUIDE.md](docs/GUIDE.md): how to use keel, step by step.
- [docs/REFERENCE.md](docs/REFERENCE.md): every skill, agent, hook, command, setting and check.

## How it is tested

- **Unit tests** (`npm test`): 77 tests, one per guarantee the CLI makes.
- **Scenario evals** (`node evals/run.mjs`): 14 scenarios run as real headless Claude Code sessions and graded with code (files, git and `keel check`), not by a model. Each scenario passes 3 runs out of 3: recording a rule, a conflicting rule, asking and answering questions, building a feature, widening a scope, adding a dependency, reviewing planted bugs, adopting a project, committing through the git hooks, registering a new project from a brief, fixing a bug, a flaky test, and a request that conflicts with an accepted rule.

```bash
node evals/run.mjs --runs 3 --jobs 4            # all scenarios (uses your Claude Code account)
node evals/run.mjs --only review,bugfix --runs 1
```

## Layout

```
bin/keel          the CLI (no dependencies)
src/              decisions, questions, features, scope and guard, check, progress, git hooks, scan
skills/           /keel:init, adopt, decide, ask, answer, state, feature, verify, review
agents/           reviewer, verifier
hooks/hooks.json  session brief, prompt reminder, guard, stop gate
references/       the working rules, the question pattern, the subagent brief
evals/            scenario harness
test/             unit tests
```

## License

[MIT](LICENSE)
