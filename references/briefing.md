# Briefing a subagent

A subagent knows only its brief and returns only its report. Write the brief so it cannot drift.

**When to delegate:** independent work that can run in parallel, a read across many files whose detail you will not need, or a review that must not see your reasoning. Do it yourself when it is a few tool calls.

**The brief has six parts:**

1. **Goal:** one sentence, the outcome, not the steps.
2. **Context:** the feature id, its checks, the decisions it cites, the files in scope. Paste them; do not say "see above".
3. **Rules:** paste points 4 to 8 of `keel rules`, or tell it to run `keel rules` first.
4. **Boundaries:** what it must not touch or decide. Product questions come back to you; it never asks the owner itself.
5. **Output:** the exact shape of the report (a table, a list of `path:line: finding`), at most N lines. Long material goes to a file whose path it returns.
6. **Done means:** the command whose output proves it.

**Model:** Haiku for mechanical edits and lookups, Sonnet for features, tests, docs and refactors, Opus for security, parsers, auth and design.

**Parallel:** send independent agents in one message. Never run the same work yourself while it runs. Treat the report as a claim to check, not a fact.
