---
name: decide
description: Record a decision the moment the user states a rule, a number, a limit, a policy or a choice - before any code. Checks it against existing records and open questions, says what it changes or contradicts, writes or supersedes the record, and quotes the owner. Use whenever the user says "let's do X", "the rule is", "it should be N", "we decided", "always/never ...", or answers a question in passing.
argument-hint: "<the rule, in the user's words>"
---

# Record a decision

Run `keel rules` once per session and follow it.

1. **Search.** `keel decision list`, then grep the decisions folder, `.keel/questions.json` (via `keel question list`) and the state file for the key words, ids and numbers in the statement.
2. **Say what it touches,** before writing: the records it changes or contradicts (by id), the open question it answers (by number), the spec files that state the old rule. If it contradicts an accepted record, say so plainly.
3. **Pick the area** with the areas in `.keel/project.json`: ask "platform?" first, then the others in order; stop at the first yes. One change in several areas: one record per area, linked.
4. **Pick the kind.** Product (money, legal, limits, a user-visible promise) or engineering.
5. **Write it:**
   ```
   keel decision new --area <A> --kind <product|engineering> --by <owner|lead> --status <accepted|proposed> \
     --title "<the rule as one sentence>" --decision "<exact rule, every number with its unit>" \
     --quote "<the owner's exact words>" [--why ...] [--context ...] [--consequences ...] [--supersedes <ID>]
   ```
   - The owner stated it: `--by <owner name> --status accepted --quote "<their words, verbatim>"`. The speaker is the owner only when the brief's `Owner:` line says so or they say it in this session; otherwise write it `--status proposed` and ask them with `/keel:ask` to confirm.
   - You or an engineer proposes it: engineering → `--by lead --status accepted`; product → `--status proposed` and open a question with `/keel:ask`.
   - It changes an existing rule: `--supersedes <old ID>`. Never edit an accepted record's rule.
6. **Close the loop:** if it answers an open question, `keel question answer <n> --answer ... --by owner --decision <new ID>`. Update every spec file that states the old rule. Link the feature: `keel feature set <id> --decision <ID>`.
7. **Gaps.** If the statement leaves a case open (a boundary, a range not covered, an exception), do not ask in free text and do not invent the rule: write the record with that case marked as open in its Decision ("Under 24 hours: open, see the question linked to this record"), then open the question with `/keel:ask`, passing `--decision <the new ID>`. Never rewrite or supersede a record just to add a question number.
8. Run `keel check`; quote its last line. Only then build. Code that implements the rule carries `// Decision: <ID>`.
