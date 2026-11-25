# The question pattern

Every question to the user or the owner, in chat or in the store, has exactly these parts. `keel question add` refuses anything else.

| Part | Rule |
|---|---|
| Kind | `product` (only the owner answers) or `engineering` (answer it yourself; store it only when you truly cannot) |
| Question | One question, one `?`, at most 300 characters, no jargon the owner would not use |
| Why it blocks | The feature check or decision that cannot move without the answer. Nothing blocked: do not ask |
| Options | 2 to 4, labelled A to D, each a concrete outcome; exactly one recommended (mark it `*` on the command line) |
| Default | What gets built if nobody answers, and how it is reversed (a setting, a flag, one constant) |
| Links | `--feature <id>` and/or `--decision <ID>` when they exist |

In chat, show it as:

```
Q-12 · product · booking.cancel
Question: What refund does a renter get when cancelling 24 to 48 hours before pickup?
Why it blocks: check booking.cancel#3 needs the number.
Options:
  A) 50% refund (recommended): matches the tiered policy in S-048
  B) No refund
  C) Full refund minus the service fee
Default if no answer: A, as a settings value an admin can change.
```

Ask several open questions together, never one per message. Use the AskUserQuestion tool when the user is present, with the same parts.
