---
name: init
description: Set up keel in a repository - the .keel config, the decisions folders, the state file, the open questions - or adopt it in an existing project with a baseline. Use when the user says "keel init", "set up keel", "start using keel here", or a keel command fails with "No keel project here".
argument-hint: "[light|full]"
---

# Set up keel

1. Run `keel help` to confirm the CLI is on PATH. If it is not, use `node "${CLAUDE_PLUGIN_ROOT}/bin/keel"` wherever this plugin says `keel`.
2. Look at the repository: the languages, the test runner, existing decision records (`docs/decisions`, `docs/adr`, `adr/`), an existing state or roadmap file.
3. Ask the user, in one AskUserQuestion call, only what you cannot read from the repository:
   - mode: `full` (decisions, scope guard, stop gate) or `light` (records and questions only, no blocking);
   - the decision areas (letters and folders); recommend `P` platform and `D` product unless records already use others;
   - who the owner is (the name used in `--by` for product answers), and whether the project is solo or a team. Solo: `--owner "<name>" --session-owner`. Team: `--owner "<name> <email>"` for each owner, with the email their git commits use; keel then decides who is an owner from each session's git identity, so a teammate's session can only propose product rules, never accept them.
4. Run `keel init --mode <mode> --owner "<name>" [--session-owner]`, then edit nothing in `.keel/project.json` yourself: tell the user which keys to set and why (`areas`, `owners`, `decisions`, `state`, `verify.quick`, `verify.full`, `verify.app`, `verify.lint`, `verify.types`, `legacyBelow` for records older than the status-line rule). Propose the exact commands from the repository (for example `npm test`, `npx eslint .`, `npx tsc --noEmit`): keel verifies with what it can run, and a project without lint or types has no quality gate.
5. **Existing project** (it has code): run `/keel:adopt` now. It writes the project summary, registers the features and rules, and baselines old tests.
6. **New project** (no code yet): ask the user for the project brief: what it is and for whom, the kinds of users, the features (existing, in progress, planned), the rules already known, what is not decided. Then register it: `keel summary set`, `keel feature add` per feature with its checks, `/keel:decide` per rule (the owner stated them: accepted, quoted), `/keel:ask` per open point.
7. **Architecture, before any code, also when the user says "decide for me" or "auto".** Propose, in one message, the stack (language, framework, storage, the dependencies worth taking), the layout as modules (each: what it is for, its folder, the modules it may import), and the test, lint and type commands. Ask once with AskUserQuestion: accept the proposal, or change it. Never skip this question: the stack and the module boundaries are the decisions every later session builds on, and the owner must have seen them. Then record each choice with `/keel:decide` (`--kind engineering`; quoted when the owner chose or changed it), and add each module: `keel module add <name> --about "…" --files "<globs>" [--uses <modules>] --decision <ID>`. `docs/ARCHITECTURE.md` is generated from them, and `keel check` fails on an import the layout does not allow.
8. Ask whether to install keel's git hooks (`keel githooks install`): pre-commit runs `keel check --changed`, commit-msg adds the active feature, pre-push runs `keel check` and `verify.quick`, post-merge rewrites the generated files; it also sets up merging of keel's records (`.gitattributes` plus a merge driver), so two branches that both add a question or a check merge cleanly. Every clone runs it once. On a team, also offer `keel ci github`: the same checks on every pull request, for people and tools without keel.
9. Run `keel check` and quote its last line. Show `keel progress`.
