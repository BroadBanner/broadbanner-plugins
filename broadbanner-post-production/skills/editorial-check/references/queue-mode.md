# Editorial check — Queue mode

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Queue mode (nightly or "review everything waiting")

1. `article_checks({ action: "queue", kind: "editorial", limit: 5 })`: drafts with an
   editorial review requested in the portal.
2. For each (at most 5 per run; the rest stay queued), run Step 0.5 with its `articleId`,
   then Steps 1–5 with `mode: "requested"` if it has a request time, else `"scheduled"`.
3. Unattended (scheduled task): **ask no questions**. If an article can't be reviewed
   (missing, forbidden, repeated `bad_evidence`), note it and continue.
4. Finish with one line per article: title, open musts, total notes.

The fresh-chat rule is satisfied by construction: the scheduled task is its own session.
The nightly `article-check-nightly` task (set up with `/fact-check`'s **Nightly task**)
runs this editorial pass first, then the fact-check queue.
