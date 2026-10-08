---
name: article-write
description: "Write or revise an opinion piece, essay, column, or other article in a brand or series voice, saved as an editable DRAFT in the member portal. Use when the user says 'write an opinion piece', 'draft an essay', 'write my column', 'help me write an article for' a series or brand, or 'revise my draft'. Loads the series/brand voice, learned style rules, and exemplars via get_writing_context, researches the archive, confirms an outline, then saves via create_article. Also tunes voice settings and learned rules. Never publishes. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Article Write

Write a general article — **opinion**, **essay**, **column**, or **other** — under one of
the creator's brands or series, in that scope's voice, and save it as an editable
**DRAFT** in the member portal. Also revise existing drafts, tune brand/series voice
settings, and manage what the system has learned about the creator's writing.

The system learns from what the creator **accepts**: drafts they edit and publish in
`app.broadbanner.com/app/articles`, articles they write by hand, and imported posts. This
skill's job is to produce a strong first draft and get it in front of the creator — the
creator's edit-and-publish is the signal that improves the next draft.

## Hard rules

- **Never publish.** Every article this skill creates is a DRAFT. `update_article` cannot
  change status, and you must not ask another tool to. Always end by telling the user to
  edit and publish in the portal.
- **Never copy exemplar facts.** Exemplars teach voice, structure and rhythm. Their
  claims, quotes, numbers and events belong to other pieces — do not reuse them.
- **Never invent facts, quotes, or sources.** Unverified claims about current events are
  flagged for the user (see Step 4).

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: post_production_distribution`. Call
`get_creator_context`; if it returns a capability summary (`entitledTools` / `caps` /
`isAdmin` / `tier`), confirm the add-on is present (or `isAdmin`), otherwise stop with:

> ⚠️ Article writing is part of the **Production+** add-on (`post_production_distribution`, $5/mo).
> Your account isn't entitled yet — add it from https://app.broadbanner.com/pricing/membership.
> Nothing was written.

If those fields are omitted (older connector), proceed — the server-side cap check on
`get_writing_context` / `create_article` is the backstop. Keep the context result: Step 1
uses it.

## Route the request first

Decide which mode the user wants before doing anything else:

| The user wants…                                           | Go to |
| --------------------------------------------------------- | ----- |
| A review of a specific episode / live show                | Hand off to the `post-production` chain (or `episode-review` if a corrected transcript is ready). Not this skill. |
| A sourced news story / roundup with citations             | If the `broad-news` plugin's `news-article` skill is available (and `whoami` shows `available.broadNews`), hand off to it. Otherwise write it here as `form: "other"` and flag every factual claim for verification. |
| A new opinion / essay / column / other piece              | Steps 1–8 below. |
| Changes to a draft that already exists                    | **Revise mode** (below). |
| "Make this series sound more X" / "our brand never says Y" | **Voice tuning** (below). |
| "What have you learned about my writing?"                 | **Learned rules** (below). |

## Step 1 — Resolve the scope (brand or series)

From `get_creator_context` (`brand`, `brands?`, `pods`):

- The user named a series → match it case-insensitively against the authorized series
  (resolve titles with `get_show_roster({ seriesId })` per `pods` id, matching
  `roster.seriesTitle`). Capture `seriesId`.
- The user named a brand, or the piece isn't tied to one series → use the brand. Capture
  the **short** `brandId` (e.g. `sotsp`, `babm`).
- Ambiguous (several brands, or the name matches several series, or nothing named and
  the creator has more than one option) → **ask**. List the candidates. Do not guess.

Use exactly one of `seriesId` or `brandId` for the rest of the run.

## Step 2 — Pick the form

`form` is one of `opinion` | `essay` | `column` | `other`. Infer it from the request
("op-ed", "hot take" → opinion; "long-form reflection", "explainer" → essay; "my weekly
column", a recurring series feature → column). If it's unclear, ask with a one-line
description of each. The form selects the reference file in Step 6:

```
article-write/references/format-opinion.md
article-write/references/format-essay.md
article-write/references/format-column.md
```

For `other`, there is no format file: follow the user's stated shape and the writing
context alone.

## Step 3 — Load the writing context (required, before any drafting)

```
get_writing_context({
  seriesId | brandId,          // from Step 1 — one of them
  form,                        // from Step 2
  keywords: ["...", "..."],    // 3–10 topic words from the user's request
})
```

It returns the effective `articleConfig`, the brand + series `voice` (and the merged
`effective` voice), the creator's personal `writingStyle`, learned `profile` + `rules`,
`exemplars`, `relatedArticles`, recent `transcripts`, and an ordered `instructions` list.

- **Follow ALL `instructions`, in order.** They are already layered: series voice →
  brand voice → personal explicit style → learned rules → style profile. Where a brand or
  series voice setting conflicts with a learned personal rule, the voice setting wins.
- **Read the exemplars for voice** — sentence length, openings, how arguments turn,
  diction, sign-offs. Pinned exemplars are the scope's "write like these" pieces; weight
  them most. Never lift their facts, quotes or claims.
- Note the `voice.effective` `signoff`, `preferredTerms`, and `dontRules` — check the
  draft against them in Step 7.

If the call returns 403, the creator can't author under that scope: say so and return to
Step 1. If it fails for another reason, report it and stop — do not draft blind.

## Step 4 — Research

Background from the creator's own archive:

1. `search_archive({ seriesId | brandId, query, limit: 10 })` with the topic. It returns
   article and transcript hits with snippets.
2. Open the most relevant few: `get_article({ slug })` for articles,
   `get_transcript({ transcriptId, version: "corrected" })` for transcripts (page with
   `nextOffset`). Use them to keep the piece consistent with what the series has already
   said, to reference past episodes/pieces, and to quote hosts accurately.
   `relatedArticles` / `transcripts` from Step 3 are good starting points too.

Factual claims about **current events** (dates, figures, who did what this week):

- Call `whoami`. If `available.broadNews` is true, ground those claims with the BroadNews
  tools (`news_search_stories`, then `news_get_story` for full text) and keep the
  supporting links for the user.
- Otherwise do **not** assert them from memory as settled fact. Write them carefully and
  collect them in a **"Claims to verify"** list (claim + why it needs checking) that you
  show the user with the draft. Do not put this list in `bodyMd`.

## Step 5 — Propose an outline and angle; confirm

Before writing the full draft, show the user:

- **Working title** and **subtitle**
- **Angle** — the one-sentence argument or through-line
- **Outline** — the section/beat list, following the form's structure
- **Key sources** — archive pieces and transcripts you'll draw on
- Any scope or form assumption you made

Wait for confirmation or changes. If the user said "just write it", proceed but still
state the angle in one line.

## Step 6 — Draft

Load the one matching `references/format-<form>.md` (skip for `other`) and write the
piece in markdown:

- Structure, length and opening/closing per the format file, adjusted by
  `articleConfig.articleLength` when set.
- Voice per the Step 3 instructions and exemplars (the format file governs shape; the
  writing context governs voice — on conflict, the writing context wins).
- `title` and `subtitle` are separate fields — do not repeat them as an H1 in `bodyMd`.
- End with the scope's `signoff` if one is set.

## Step 7 — Self-check, then save as a draft

Check before saving:

- [ ] Every `instructions` item honoured; no `dontRules` term or phrase present
- [ ] `preferredTerms` used in place of the terms they replace
- [ ] No fact, quote or number taken from an exemplar
- [ ] Every quote traceable to a transcript or article you actually read
- [ ] Current-events claims either BroadNews-grounded or on the "Claims to verify" list
- [ ] Length and structure match the format file

Then:

```
create_article({
  origin:   "ai",
  form:     "<opinion|essay|column|other>",
  seriesId: "...",            // OR brandId — never both
  title:    "...",
  subtitle: "...",            // optional
  bodyMd:   "...",
  tags:     ["...", "..."],   // 2–6 topic tags
})
```

It returns `{ ok, id, slug, url }`. Retry transient/5xx errors up to 3× with backoff; on
an authorization error stop and report; on a request-shape error fix the argument and
re-call once.

## Step 8 — Report

```
Draft saved — nothing is public until you publish it.

Title:  ...
Form:   opinion · Series: ...  (or Brand: ...)
Draft:  https://app.broadbanner.com/app/articles/...

Claims to verify: (list, or "none")

Edit it in the portal and publish when it's right — your edits are how BroadBanner
learns your voice for the next draft. Or tell me what to change and I'll revise it.
```

## Revise mode

When the user asks for changes to a draft (this run's, or an existing one):

1. Identify the article: from this session's `create_article` result, or
   `list_articles` → match by title, then `get_article({ slug })` for the current body.
2. To show history or compare, call `list_article_revisions({ id })` and summarize
   (revision number, source AI/You/Imported/Restored, time, word count, note). If the
   creator has edited it since your draft, **build on their latest text** — never
   overwrite their edits with an older AI version.
3. Re-load `get_writing_context` if this is a new session.
4. Apply the feedback and save with
   `update_article({ id, title?, subtitle?, bodyMd?, form?, tags?, revisionNote })`
   — pass only the fields that changed; `revisionNote` is a short description of the
   change (e.g. "tightened the open, cut section 3"). It cannot publish.
5. Report the URL and the revision note, and remind the user to publish in the portal.

## Voice tuning

When the user says things like "make Palantalk sound more combative" or "remember our
brand never says 'folks'":

1. Decide the **scope** and tell the user which you're editing:
   - **Brand** voice applies to every series under the brand.
   - **Series** voice applies to that series only and **overrides the brand** field by
     field (do/don't rules and preferred terms are combined, series first).
   If it's unclear which they mean, ask.
2. `get_voice({ scope: "brand" | "series", id })` to read the current settings
   and `canEdit`. If `canEdit` is false, explain that only the series host / brand owner
   (or an admin) can change it, and stop.
3. Map the request onto fields (see `references/voice-fields.md`) and show the proposed
   change as before → after.
4. On confirmation, `set_voice({ scope, id, ...changedFields })` — merge
   semantics: send only changed keys; `null` clears a field. For list fields
   (`doRules`, `dontRules`, `preferredTerms`, `tone`), send the full new list (existing
   items + the addition).
5. Confirm what changed and that it applies to future drafts for that scope.

## Learned rules

When the user asks what the system has learned, or wants to correct it:

- `article_style_rules({ action: "list" })` — show rules grouped by status (candidate /
  confirmed), each with its evidence count.
- `article_style_rules({ action: "confirm", ruleId })` — the creator agrees; it becomes a
  firm instruction.
- `article_style_rules({ action: "dismiss", ruleId })` — wrong or unwanted; it stops
  applying.
- `reset` only on an explicit request, after confirming it wipes the learned memory.

These rules are **personal** — they follow the creator across all brands and series.
Brand/series voice is set separately (Voice tuning).

## Error handling

- **No scope resolvable / 403 on writing context:** list the creator's series and brands
  and ask; do not draft.
- **`create_article` / `update_article` authorization error:** stop — the session isn't
  entitled or doesn't own the article.
- **Archive search empty:** proceed from the user's brief and the writing context; say
  that no archive background was found.
- **Draft lost mid-session:** the article is in D1 — recover it with `list_articles` /
  `get_article`, never by re-creating a duplicate.
