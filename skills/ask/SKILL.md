---
name: ask
description: Ask the owner a product question in keel's fixed pattern (kind, one question, why it blocks, 2-4 options with one recommended, default) and store it. Use when work is blocked on a product, money, legal, limit or user-promise choice that no record answers. Engineering questions are answered by you, not asked.
argument-hint: "<what is blocked>"
---

# Ask the owner

Run `keel rules questions` and follow it.

1. **Is it engineering?** Structure, libraries, naming, how to build a rule: decide it yourself and record it with `/keel:decide` (kind engineering). Stop here.
2. **Is it already answered?** Search `keel decision list`, the resolutions files and `keel question list`. If answered, cite it and stop.
3. **Write it** in the pattern and store it:
   ```
   keel question add --kind product --feature <id> [--decision <ID>] \
     --question "<one question?>" --blocks "<the check or decision that waits>" \
     --option "*<recommended outcome>" --option "<outcome>" [--option ...] \
     --default "<what gets built meanwhile, and how it is reversed>"
   ```
   If keel refuses it, fix every listed problem; never work around the pattern.
4. **Show it** to the user in the pattern. If the user is here, ask with AskUserQuestion (recommended option first, "(Recommended)" in its label). Batch open questions in one call, at most four.
5. **A stored question is badly worded** (two questions in one, unclear): add the replacements first, then `keel question withdraw <n> --by lead --reason "split into Q-<a> and Q-<b>"`. Never edit the store.
6. **Build the default** meanwhile, reversible, marked `// Decision: pending Q-<n>`.
