---
name: feature
description: Build one feature end to end the keel way - register it, write its checks, settle its decisions and questions, lock the scope, build with one test per check, verify, review and close. Use when the user asks to build, add, implement, change or finish a feature, a screen, an endpoint or a flow.
argument-hint: "<feature id, such as booking.cancel> [what it should do]"
---

# Build a feature

Run `keel rules` first and follow it. One feature at a time.

## 1. Start

1. `keel feature show <id>`. If it does not exist: `keel feature add <id> --title "<what the user can do>" --files "<globs this work may touch>"`. Ids are lowercase words joined by dots.
2. **Risk.** Set it: `keel feature set <id> --risk high` for sign-in, sessions, payments, permissions, uploads, data deletion, or anything strangers reach over the network; `--risk low` for copy, styles and docs; leave `normal` otherwise. Risk decides how deep `/keel:review` looks.
3. **Checks first.** Write each behaviour the feature must have as one check: `keel feature check <id> --add "<one behaviour, observable>"`. Take them from the user's words and the decisions; do not invent edge cases the user did not ask for. **High risk adds the abuse cases**, one check each, because nobody asks for them and review finds them too late: guessing and flooding have a limit; every action checks who is asking; cross-site requests are refused; a malformed or huge input is refused without a crash; sign-out and expiry end access everywhere. A limit's number is the owner's: `/keel:ask` with a default. Show the list to the user before building.
4. **Decisions.** Any rule the checks depend on and no record states: `/keel:decide` (engineering) or `/keel:ask` (product, with a reversible default). Link them: `keel feature set <id> --decision <IDs> --status building`.
5. **Lock the scope:** `keel scope start <id>`. If the project has a pattern pack (`pattern` in `.keel/project.json`), follow its layout.

## 2. Build

6. For each check, in order: write its one test (`Covers: <id>#<n>` in the name or a comment just above), run it and see it fail, then make it pass. Stop at the check; no extra features.
7. Independent checks may go to subagents: brief them as `keel rules briefing` says, one check each, in one message.
8. Blocked by the scope guard: widen only with a reason (`keel scope widen '<glob>' --reason '<why>'`) when this work touches the path once; if the feature will own the path from now on, `keel feature set <id> --files '<glob>' --reason '<why>'`. Blocked on a dependency: record an engineering decision, then `keel scope deps <ID>`.

## 3. Close

9. `/keel:verify`. Then `/keel:review` on the diff; fix or answer every finding.
10. `keel feature set <id> --status built`, `keel scope clear`, `keel check`, `keel progress <id>`. Quote the last line of each verify command and of `keel check`.
11. Report in at most 10 lines: the progress line, checks covered, decisions taken, questions left for the owner, anything mocked.
