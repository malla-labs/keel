---
name: review
description: Review the current diff in fresh contexts that never saw the reasoning behind it - reviewers find bugs, broken decisions and uncited tests, a separate verifier confirms each finding, and only confirmed findings come back, tagged important, nit or pre-existing. Use before a commit or PR, after a feature, or when the user asks for a review.
argument-hint: "[quick|deep] [base ref, default: the merge base with the main branch]"
---

# Review the diff

1. **The diff:** `git diff <base>...HEAD` plus uncommitted changes (`git diff HEAD`). Note the changed files, the feature in scope (`keel scope show`) and the decisions the diff cites.
2. **Find, in fresh contexts.** Start in one message:
   - `keel:reviewer` with lens **correctness** (logic, edge cases the checks name, error handling, data loss, security);
   - `keel:reviewer` with lens **rules** (the diff against the cited decisions and the feature's checks, the pattern's layout, tests without `Covers:`, scope creep, a rule in code with no record).
   - `deep` adds a third with lens **regressions** (callers of changed functions, contracts, migrations).
   Brief each with: the base ref, the list of changed files, the feature id and its checks (`keel feature show`), the decision ids, the project's `REVIEW.md` or `docs/REVIEW.md` if it exists. Do not send your own reasoning or conclusions.
3. **Verify, separately.** Send every finding to `keel:verifier` in one brief (for `deep`: three verifiers, keep a finding only when two or more confirm). Every round of findings is verified, including re-reviews: never skip the verifier because a finding looks obvious.
4. **Record every finding,** confirmed or rejected, so keel knows what review found and the next review does not raise a rejected one again:
   ```
   keel review add --feature <id> --where <path:line> --severity <important|nit|pre-existing> \
     --verdict <confirmed|rejected> --summary "<the problem>" [--reason "<why the verifier rejected it>"]
   ```
5. **Report** the confirmed findings, most severe first, as `R-n path:line: [important|nit|pre-existing] problem. fix.` No style findings.
6. **Resolve:** every confirmed important finding is fixed or answered with a reason, then `keel review resolve R-n --fixed "<what changed>"` or `--answered "<why it stays>"`. A fix that adds behaviour adds a check for it first (`keel feature check <id> --add`), with its test. keel refuses "built" while an important finding is open. After fixes, re-review only the new diff. After three rounds with important findings still open, stop and ask the user to reconsider the approach.
