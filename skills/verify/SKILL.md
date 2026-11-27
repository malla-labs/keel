---
name: verify
description: Prove the current change works, with evidence - keel's own check, the project's targeted tests and, when it has one, the running app - in a fix loop that stops after three failed rounds. Use before saying "done", before a commit or PR, and when the user asks to verify, test, or check the work.
argument-hint: "[quick|full]"
---

# Verify the change

1. **keel's check:** `keel check --changed`. Fix every error. Warnings about uncovered checks are work, not noise.
2. **Tests, lint, types:** `keel verify` (`keel verify --full` for `full`) runs `verify.quick` (or `verify.full`), then `verify.lint` and `verify.types` when set, and stops at the first failure. No `verify.quick`: find the runner (package.json scripts, gradle, xcodebuild, pytest), run only the tests that cite the changed checks and decisions, and tell the user to set `verify.quick`, `verify.lint` and `verify.types` (only the owner edits `.keel/project.json`).
3. **The app,** when the change is visible to a user and `verify.app` is set or the project has a run or e2e skill: start it and drive the changed flow once; for UI, take a screenshot and compare with the design. Save the screenshot or log under the project's ignored scratch folder and name it in the record (step 5).
4. **Loop:** on a failure, find the cause, fix it, rerun only what failed. Never weaken a test, skip it, add a sleep or a retry, or edit the check that failed to make it pass. After three rounds on the same failure, stop: report what you tried and recommend a way forward.
5. **Record it.** When everything passed and the change belongs to a feature: `keel feature verified <id> --run [--evidence "<what else proves it: a screenshot path, the flow driven in the app>"]`. With `--run` keel runs the commands itself and records their last lines, so the record is keel's evidence, not yours. Only without `verify.quick`: `--command "<the command that passed>"`. keel refuses while a check has no test or `keel check` fails. The record goes stale by itself when the feature's files change; when a shared file made other features stale, run `keel feature verified --stale --run`.
6. **Report evidence:** each command run and its last lines. "Tests pass" without output is not a result.
