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
   - who the owner is (the name used in `--by` for product answers), and whether the person running these sessions is that owner (solo project: pass `--session-owner`; team project: leave it off, so product rules stated in a session stay proposed until the owner accepts them).
4. Run `keel init --mode <mode> --owner "<name>" [--session-owner]`, then edit nothing in `.keel/project.json` yourself: tell the user which keys to set and why (`areas`, `owners`, `decisions`, `state`, `verify.quick`, `verify.full`, `verify.app`, `verify.lint`, `verify.types`, `legacyBelow` for records older than the status-line rule). Propose the exact commands from the repository (for example `npm test`, `npx eslint .`, `npx tsc --noEmit`): keel verifies with what it can run, and a project without lint or types has no quality gate.
5. **Existing project** (it has code): run `/keel:adopt` now. It writes the project summary, registers the features and rules, and baselines old tests.
6. **New project** (no code yet): ask the user for the project brief: what it is and for whom, the kinds of users, the features (existing, in progress, planned), the rules already known, the stack and pattern, what is not decided. Then register it: `keel summary set`, `keel feature add` per feature with its checks, `/keel:decide` per rule (the owner stated them: accepted, quoted), `/keel:ask` per open point.
7. Ask whether to install keel's git hooks (`keel githooks install`): pre-commit runs `keel check --changed`, commit-msg adds the active feature, pre-push runs `keel check` and `verify.quick`. They keep the rules for people and other tools too, and never overwrite existing hooks.
8. Run `keel check` and quote its last line. Show `keel progress`.
