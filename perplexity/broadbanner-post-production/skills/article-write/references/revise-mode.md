# Article Write — Revise mode

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Revise mode

When the user asks for changes to a draft (this run's, or an existing one):

1. Identify the article: from this session's `create_article` result, or
   `list_articles({ q: "<words from the title>" })` → match, then `get_article({ slug })` for
   the current body. Always pass `q`; never list the whole archive to find one piece.
2. To show history or compare, call `list_article_revisions({ id })` and summarize
   (revision number, source AI/You/Imported/Restored, time, word count, note). If the
   creator has edited it since your draft, **build on their latest text** — never
   overwrite their edits with an older AI version.
3. Re-load `get_writing_context` (and Step 0.5 with `articleId`) if this is a new session.
4. Apply the feedback and save with
   `update_article({ id, title?, subtitle?, bodyMd?, form?, tags?, socialCopy?, revisionNote })`
   — pass only the fields that changed; `revisionNote` is a short description of the
   change (e.g. "tightened the open, cut section 3"). It cannot publish.
5. **Refresh the linked content, unasked.** If the save result has `refreshLinked`, run the
   pass in `../../references/linked-content.md` (the article's scripts and its own blurbs:
   rewrite only what changed as drafts, or mark them reviewed).
6. Report the URL, the revision note and the linked items you refreshed, and remind the user to
   publish in the portal.

### Fixing fact-check findings

When the user asks to "address the fact-check" (or a draft has an open check):

1. `article_checks({ action: "list", articleId, kind: "fact", view: "open" })`: the status,
   the newest check, and only the **open** findings (paragraph, claim, evidence,
   suggestion). Use `view: "all"` only to show history.
2. Fix each one in the text, using the finding's evidence; never add a new fact without a
   source. If you disagree with a finding, leave the text and tell the user why; they can
   dismiss it with a note in the portal.
3. **Fix the attached social copy too.** `get_article` returns `socialCopy` (the
   Substack / Bluesky / Threads blurbs). The blurbs were written from the original draft,
   so a corrected claim often survives there. For each fix, check every blurb. If the
   wording is affected, send the **full** corrected object in the same `update_article`
   (`socialCopy`), keeping every platform key and its shape (a string, or `{ text }`). Never
   tell the user to fix social copy in the editor when you can do it here. The article's
   **scripts** get the same pass afterwards from `refreshLinked` (step 8).
4. Fix **every** open finding in **one** revision: one `update_article` with
   `resolves: [{ findingId, note }]` for every finding it fixes (they're marked fixed against
   the new revision in the same call). No separate resolve calls.
5. **Series parts.** If the article is one part of a series and a fix changes a shared fact,
   claim, scorecard row or attribution, find the sibling parts
   (`list_articles({ seriesId })`), apply the same fix to each in this session, and tell
   the user which parts you changed.
6. **Learn from the fixes** (Ki loaded): `../../references/personality.md` §5 with this
   `articleId`. Do it once per round, after the resolves.
7. Tell the user to run `/fact-check` again in the **checker** chat to confirm. Say
   which blurbs you changed, if any.
8. **Linked content.** Run the `refreshLinked` pass from the save result
   (`../../references/linked-content.md`) before you report.

### Addressing editorial notes

When the user asks to "address the editorial notes" (or "Mo's notes"):

1. `article_checks({ action: "list", articleId, kind: "editorial", view: "open" })`: the
   newest editorial check's **open** notes (paragraph, lens, must/should/could,
   articleQuote, suggestion). Do the musts first.
2. Revise the text (Revise mode). The suggestion is a direction, not a script: keep the
   voice. Never add a new fact to satisfy a note. Leave a "Flag for fact-check" note for
   the fact-check; don't change the fact here. If you disagree with a note, leave it and
   say why (the user can dismiss it in the portal).
3. Check the social copy as above if a fix changes the framing or headline, then run the
   `refreshLinked` pass from the save result (`../../references/linked-content.md`).
4. Apply the musts, shoulds **and** coulds you accept in **one** revision; a could never gets
   a revision of its own. Resolve them in that same `update_article` with `resolves[]`.
   Then learn from the fixes (Ki loaded): `../../references/personality.md` §5 with this
   `articleId`.
5. Tell the user the next step is `/fact-check` in a **fresh** chat on this final
   revision (re-running `/editorial-check` is optional; with the brand gate on, only open
   musts block publishing).
