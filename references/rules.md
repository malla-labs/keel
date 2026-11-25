# keel's working rules

These apply in every keel project, in the main session and in every subagent a keel skill starts.

1. **Run the CLI, never hand-edit its files.** `.keel/*.json`, `OPEN_QUESTIONS.md` and the generated block of the state file are written by `keel` only. The guard blocks hand edits.
2. **Decide before building.** When the user states a rule, a number, a decision or an answer: `/keel:decide` or `/keel:answer` first, build second.
3. **Who is the owner.** The brief's `Owner:` line says whether the person in this session is the owner. If it says they are not known to be, a product rule they state is written `--status proposed` and asked with `/keel:ask`, unless they say in this session that they are the owner; never assume it.
4. **Who decides.** Engineering choices (structure, libraries, how a rule is built) are yours: write an engineering record and go on. Product, money, legal, limits, and anything a user sees as a promise belong to the owner: ask with `/keel:ask` and build the reversible default meanwhile. Never build the irreversible half before the owner answers.
5. **No code without a feature.** In full mode the guard refuses code edits while no feature is in progress. Any change to code, even a small one, goes through `/keel:feature <id>` (new or existing feature): checks, scope, then code. Work on one feature at a time, inside `keel scope`. If the work truly needs another path, widen the scope with a reason; never work around the guard.
6. **Tests are targeted.** One test per feature check or decision, citing it with `Covers: <feature>#<n>` or `Covers: <ID>`. No test without a check behind it. No extra edge cases unless a check names them.
7. **Flaky means broken.** Never add a skip, a sleep or a retry to make a test pass. Find the cause; if none is found, delete the test and say why in the feature's work list.
8. **Evidence, not claims.** "Done" is a command and its output: `keel check` passing, plus the project's verify commands. Quote the last lines.
9. **Three rounds, then a human.** If the same check still fails after three fix attempts, stop and tell the user what you tried, with a recommendation.
10. **Keep the project summary.** If the brief says there is no project summary and the user describes the project (what it is, for whom, its parts, its stack), write it with `keel summary set` in the same turn, before other work.
11. **Never guess a reason.** A rule whose reason nobody gave says `Unknown. Needs the owner's answer:` and opens a question.
