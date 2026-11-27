---
name: review
description: Review the current diff in fresh contexts that never saw the reasoning behind it - reviewers chosen by the feature's risk find bugs, broken decisions, quality costs and security holes, a separate verifier confirms each finding, and every verdict is recorded as an R-number. Use before a commit or PR, after a feature, or when the user asks for a review.
argument-hint: "[quick|deep] [base ref, default: the merge base with the main branch]"
---

# Review the diff

1. **The diff:** `git diff <base>...HEAD` plus uncommitted changes (`git diff HEAD`). Note the changed files, the feature in scope (`keel scope show`) and the decisions the diff cites.
2. **Pick the lenses by the feature's risk** (`keel feature show <id>`, field `risk`; `quick` or `deep` given by the user wins):
   | Risk | Lenses |
   |---|---|
   | `low` (copy, styles, docs, a test-only change) | correctness |
   | `normal` (the default) | correctness, rules, quality |
   | `high` (sign-in, sessions, payments, permissions, anything reached from the network by strangers, file uploads, data deletion) | correctness, rules, quality, security, regressions |
   A diff that touches a high-risk feature's files is reviewed as high even if it was started from another feature.
3. **Find, in fresh contexts.** Start one `keel:reviewer` per lens, in one message:
   - **correctness**: logic, edge cases the checks name, error handling, data loss;
   - **rules**: the diff against the cited decisions and the feature's checks, the pattern's layout, tests without `Covers:`, scope creep, a rule in code with no record;
   - **quality**: duplication, dead code, misleading names, swallowed errors, inline product numbers, breaks with the project's own patterns;
   - **security**: trust boundaries, limits, cross-site requests, injection, sessions, crashes from bad input;
   - **regressions**: callers of changed functions, contracts, migrations.
   Brief each with: the base ref, the list of changed files, the feature id and its checks (`keel feature show`), the decision ids, the project's `REVIEW.md` or `docs/REVIEW.md` if it exists. Do not send your own reasoning or conclusions.
4. **Verify, separately.** Send every finding to `keel:verifier` in one brief (for `deep`: three verifiers, keep a finding only when two or more confirm). Every round of findings is verified, including re-reviews: never skip the verifier because a finding looks obvious. `high` risk: two verifiers, keep a finding when either confirms a security finding, or both confirm any other.
5. **Record every finding,** confirmed or rejected, so keel knows what review found and the next review does not raise a rejected one again:
   ```
   keel review add --feature <id> --where <path:line> --severity <important|nit|pre-existing> \
     --verdict <confirmed|rejected> --summary "<the problem>" [--reason "<why the verifier rejected it>"]
   ```
6. **Report** the confirmed findings, most severe first, as `R-n path:line: [important|nit|pre-existing] problem. fix.` No style findings.
7. **Resolve:** every confirmed important finding is fixed or answered with a reason, then `keel review resolve R-n --fixed "<what changed>"` or `--answered "<why it stays>"`. A fix that adds behaviour adds a check for it first (`keel feature check <id> --add`), with its test. keel refuses "built" while an important finding is open. After fixes, re-review only the new diff. After three rounds with important findings still open, stop and ask the user to reconsider the approach.
