---
name: answer
description: File the owner's answer to an open keel question - it leaves the open list, goes into the day's resolutions, becomes a decision when it states a rule, and leaves work on the feature. Use when the user answers a Q-number, picks an option, or says "go with A".
argument-hint: "<Q-number> <answer>"
---

# File an answer

1. `keel question list` and find the question. Product questions are answered only by the owner.
2. If the answer states a rule (a number, a policy, a limit), first write the record with `/keel:decide` (`--by owner --status accepted --quote "<their words>"`).
3. File it:
   ```
   keel question answer <n> --answer <A|B|...|free text> --by owner --quote "<their words>" \
     [--decision <ID>] [--work "<what remains to build>"]
   ```
4. If the answer differs from the default you built, list the code to change and add it with `--work`.
5. **Code that named the question** (`Default until Q-3 is answered`) now cites the decision instead: `keel check` warns on every `Q-n` that is no longer open. That edit belongs to the question's feature, through `/keel:feature`.
6. `keel check`; quote its last line.
