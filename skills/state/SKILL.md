---
name: state
description: Show where the project stands and how far along it is - overall and per-feature progress, checks with tests, verified or stale features, the active scope's progress, the weekly pace, open work and what waits for the owner - from keel's own records. Use when the user asks "where are we", "how far along", "progress", "what's next", "what's pending", "what's mocked", or at the start of a work session.
argument-hint: "[feature id]"
---

# Where things stand

1. Run `keel progress` (or `keel progress <id>` for one feature, which lists the checks without a test) and `keel question list --kind product`.
2. Show the progress output as it is, in a code block. Then, in at most 8 lines: what blocks the features in progress (checks without a test, stale verifications, questions waiting for the owner, proposed product records), and the work items from answers.
3. Recommend the next feature to work on and why (blocked items last). Do not start it unless asked.
