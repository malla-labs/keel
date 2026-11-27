---
name: verify
description: Prove the current change works, with evidence - keel's own check, the project's targeted tests and, when it has one, the running app - in a fix loop that stops after three failed rounds. Use before saying "done", before a commit or PR, and when the user asks to verify, test, or check the work.
argument-hint: "[quick|full]"
---

# Verify the change

1. **keel's check:** `keel check --changed`. Fix every error. Warnings about uncovered checks are work, not noise.
2. **Targeted tests:** read `verify.quick` from `.keel/project.json` and run it (or the test runner on the changed files only). `full` runs `verify.full`. No command configured: find the runner (package.json scripts, gradle, xcodebuild, pytest) and run only the tests that cite the changed checks and decisions; tell the user to set `verify.quick`.
3. **The app,** when the change is visible to a user and `verify.app` is set or the project has a run or e2e skill: start it and drive the changed flow once; for UI, take a screenshot and compare with the design. Save the screenshot or log under the project's ignored scratch folder and name it in the record (step 5).
4. **Loop:** on a failure, find the cause, fix it, rerun only what failed. Never weaken a test, skip it, add a sleep or a retry, or edit the check that failed to make it pass. After three rounds on the same failure, stop: report what you tried and recommend a way forward.
5. **Record it.** When everything passed and the change belongs to a feature: `keel feature verified <id> --command "<the verify command that passed>" [--evidence "<what else proves it: a screenshot path, the flow driven in the app>"]`. keel refuses while a check has no test or `keel check` fails. The record goes stale by itself when the feature's files change; when a shared file made other features stale, run `keel feature verified --stale --command "<it>"` after the full test command passed.
6. **Report evidence:** each command run and its last lines. "Tests pass" without output is not a result.
