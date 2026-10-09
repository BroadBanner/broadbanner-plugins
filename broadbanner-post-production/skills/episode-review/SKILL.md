---
name: episode-review
description: "Generate a publication-ready review from a corrected transcript, using the show's SERVER-SOURCED editorial config. Use when the user wants to write the review, episode writeup, or post-show summary, or after transcript-correction in the post-production chain. Reads articleFormat / editorialVoice / articleLength and more from the BroadBanner MCP connector's get_show_roster effectiveArticleConfig (NOT local config), loads only the matching format + voice references, and produces the article markdown + social copy. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Episode Review

Generate a publication-ready review from a corrected transcript. This skill reads the
show's **server-sourced** editorial config — the `effectiveArticleConfig` block from the
BroadBanner MCP connector's `get_show_roster` — to determine the review format and
editorial voice, loads only the relevant references, and produces the complete review
document plus social distribution copy.

**What's new vs. the legacy episode-pipeline review:** format, voice, length, takeaway
range, mode, and label come from the connector's `effectiveArticleConfig`, not from a local
`broadbanner.config.json`. The reference-file mechanism (`format-<name>.md` /
`voice-<name>.md`) is unchanged — the tag *values* just arrive from the server.

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: post_production_distribution`. Call
`get_creator_context`; if it returns a capability summary
(`entitledTools` / `caps` / `isAdmin`), confirm the add-on is present (or `isAdmin`),
otherwise stop with the CTA. If the fields are omitted (older connector), proceed. When
invoked by the `post-production` orchestrator, this has already run — don't repeat it.

> ⚠️ Post-production is the **Production+** add-on (`post_production_distribution`, $5/mo).
> Your account isn't entitled yet — add it from https://app.broadbanner.com/pricing/membership.

## What this skill does NOT do

It produces the review as a markdown file (+ social copy). It does **not** publish. Pushing
the review as a portal DRAFT is the `article-publish` skill's job (there is no Pages/git
step in this plugin).

## Inputs

| Input                    | Required | Example                                             | Notes                                                            |
| ------------------------ | -------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Corrected transcript     | Yes      | `transcriptId` (or the text already in context)     | Stored in D1 by transcript-correction; read with `get_transcript` |
| Resolved series + roster | Yes      | `{ seriesId, seriesTitle, primaryHost, hosts[], guests[], effectiveArticleConfig }` | From the orchestrator's Step 0 (`get_show_roster`) |
| `episodeSlug`            | Yes      | `e12-surveillance-capitalism-and-you`               | For the output filename                                          |
| `episodeTitle`           | Rec.     | `Palantalk | E12 - Surveillance Capitalism and You` | The draft's title (SEO title source)                            |
| `episodeDate`            | Rec.     | `2026-03-31`                                        | For the SEO title / date suffix; default today if unknown        |

If the user just ran transcript-correction, carry these forward. If the corrected text
isn't in context (a resumed run or new session), read it back with
`get_transcript({ transcriptId, version: "corrected" })` — or by `seriesId` +
`episodeSlug` — following `nextOffset` until it's null. Never depend on a local
transcript file.

## Step-by-step workflow

### Step 1: Resolve the editorial config (server-sourced)

Use the `effectiveArticleConfig` from the resolved roster (the orchestrator already fetched
it; if you don't have it, call `get_show_roster({ showId })` / `({ seriesId })` and read
`roster.effectiveArticleConfig`). Extract:

- `articleFormat` → the structural template tag (`summary` | `narrative` | `book-review` | …)
- `editorialVoice` → the tone tag (`data-fact` | `opinionated-fact` | `analytical-literary` | …)
- `articleLength` → paragraph/sentence length guidance
- `takeawayCountRange` → how many key-takeaway bullets (summary format)
- `seasonBookMode` → `season` | `book` | `episodic` (affects labeling/title shape)
- `articleLabel` → the human label for this review kind (carried into publish)

Also use the roster's `primaryHost`, `hosts[]`, `guests[]` for attribution, the signature
line, and `authorNames`.

`effectiveArticleConfig` resolves **show ?? series ?? brand**, so a series with no review
config inherits the brand's article defaults. **Only if it is still missing, or
`articleFormat`/`editorialVoice` are still empty:** STOP and report — neither the series
nor its brand is configured for reviews on the server. Ask the operator to set the review
config for this series (or the brand's Article defaults) in the portal. Do NOT fall back to
a hardcoded default; explicit is better than implicit.

### Step 2: Load references by tag

Load exactly two reference files based on the resolved tags:

```
episode-review/references/format-<articleFormat>.md
episode-review/references/voice-<editorialVoice>.md
```

**If either file is missing:** STOP and report:

```
No reference found for tag '<tag-value>'.
Available formats: [list files matching references/format-*.md]
Available voices:  [list files matching references/voice-*.md]
```

Load only what the tags specify — do NOT load all format/voice files. That is the
efficiency mechanism.

### Step 3: Read the corrected transcript

Read the full corrected transcript. Its header (added by transcript-correction) gives you
the primary host, hosts, guest(s), episode title, and date — cross-check against the
roster you already hold.

Extract the episode spine as internal working notes (not in the output):

- Core claim/purpose (1-2 sentences)
- 2-5 main themes
- Turning points / key exchanges
- Calls to action stated by hosts/guests
- Direct quotes worth capturing (block-quote / pull-quote candidates)

### Step 3b: Load the writing context (voice + writing memory)

BroadBanner learns from every review this creator publishes. It compares the published text and social copy with the draft that `article-publish` filed, so the creator's edits teach the next draft. The same call carries the brand and series **voice** settings. Load it now, using the episode's main themes from Step 3 as keywords:

```
get_writing_context({
  showId: "<showId>",          // preferred; else seriesId: "<seriesId>"
  form: "episode-review",
  keywords: [<2–5 main themes>],
})
```

It returns:

- **`voice`:** the series and brand voice settings (summary, audience, tone, perspective, do/don't rules, preferred terms, sign-off), series over brand.
- **`instructions[]`:** in order — series voice, brand voice, the creator's explicit settings, then learned habits (word choices they consistently make, such as "rebukes" not "slams", words they keep cutting, how long their published reviews run, sign-offs, punctuation).
- **`exemplars[]`:** reviews they published (pinned and same-series first) and their social copy (`kind: blurb_*`). Match their voice, rhythm, openings and how they frame takeaways.
- **`relatedArticles[]`:** published BroadBanner articles on the same topics, with public URLs.

**Precedence when they conflict:**
1. The transcript (facts, quotes).
2. The server config and the **format** reference: structure, length and labels always win.
3. The **explicit brand/series voice** lines in `instructions[]` (series over brand). They refine the tone and override the `voice-*.md` preset where they disagree.
4. The `voice-<editorialVoice>.md` preset from Step 2: the base tone.
5. The creator's learned habits in `instructions[]`: apply word choices, cuts and sign-offs wherever they don't contradict 1–4.
6. `exemplars[]`: a style reference only.

**Never** take facts, quotes or names from exemplars; they're other episodes. If the call fails, returns nothing (a new creator), or the connector lacks the tool, carry on with the preset alone and mention it in the Step 6 report. It is an enhancement, not a gate.

### Step 4: Generate the review

Follow both loaded references, refined by the writing context:

- **The format reference** controls structure: section order, required sections, length
  constraints, title format. **Exception:** if the writing context has an article template
  (`voice.effective.template`), its sections and order replace the format reference's
  structure. Fill every `[bracketed note]` and leave none in the output; the format
  reference's length and title rules still apply.
- **The voice reference** controls the base tone: attribution style, editorial stance,
  sentence construction, what to avoid.
- **The writing context `instructions`** (Step 3b) refine the tone — the scope's do/don't
  rules, preferred terms, sign-off, and the creator's learned edits. Explicit voice
  settings win over the preset on conflict.

Apply the server config as the binding constraints:

- Paragraph/sentence lengths per the format spec **and** the show's `articleLength`.
- Key-takeaway count within the show's `takeawayCountRange` (summary format).
- Title shape appropriate to `seasonBookMode` — but the SEO title's episode label comes
  from the draft's `episodeTitle` (derived in transcript-download), not a local
  `titleFormat`. For episodic-mode shows there is no S/E numbering.
- **Quotes must be real** — every block/pull quote comes directly from the transcript.
  Paraphrase-and-attribute if unclear; never invent.
- Book links (book-review format): publisher > independent bookstore > thrift; no large
  tech-company bookstores.

Apply the writing memory from Step 3b within those constraints: the creator's word choices, cuts, sign-off and typical length.

**Related reading (optional).** If `relatedArticles` includes BroadBanner pieces that genuinely add context for a reader, end the body with a short list, at most 3, the creator's own first:

```
## Related reading

- [Title](url)
```

They're links for readers, never sources for what was said on the show. Skip this if the format reference defines its own closing.

Produce the review body **and** the social distribution copy (Substack blurb, Bluesky
post ≤300 chars, YouTube description) per the format reference's Social Distribution Copy
section. Write it in the creator's voice from Step 3b, using the blurb exemplars. Substack copy carries no hashtags. Keep the social copy as a distinct block — `article-publish` passes it to
`create_article` as `socialCopy`.

### Step 5: Hold the output

Keep the article markdown in context — `article-publish` pushes it straight to the portal
via `create_article`. Optionally also write a scratch copy to
`/tmp/post-production/<seriesId>_review_<episodeSlug>.md` (handy for a long review in a
local session), but nothing downstream may require that file: in a remote Cowork
environment it won't outlive the session. There is no Pages directory or git write in
this plugin.

### Step 6: Report to the user

Present:

- The review markdown (or the scratch path, if you wrote one)
- The SEO title and subtitle for quick confirmation
- The block quote (narrative/book-review) or the takeaway bullets (summary) for a quality
  check
- Config used: `articleFormat: <value>`, `editorialVoice: <value>`, `articleLabel: <value>`
- Writing context: loaded (N instructions, M exemplars) — or "not available, preset only"
- `authorNames` derived from the roster (primary host + hosts)
- Next: "Review ready. Next: article-publish (push as a portal DRAFT)."

**Carries forward:** the review markdown (+ `reviewPath` if written), `transcriptId`, `seoTitle`, `subtitle`, `bodyMd` (the review body
markdown), `socialCopy`, `articleLabel`, `authorNames`.

## Output quality checks

Before delivering, verify:

- [ ] SEO title reflects the draft's episode title + date
- [ ] Body meets the paragraph/sentence requirements for the loaded format and `articleLength`
- [ ] Takeaway count (if applicable) is within `takeawayCountRange`
- [ ] All quotes come directly from the transcript
- [ ] No fabricated timestamps, sources, or events
- [ ] Lists are 2-5 items
- [ ] Book links (if any) follow the linking policy
- [ ] Social distribution copy is present (Substack, Bluesky, YouTube)
- [ ] Speaker attribution matches the live roster (primary host / hosts / guests)
- [ ] Editorial voice matches the loaded voice reference, refined by every writing-context instruction
- [ ] No `dontRules` phrase present; `preferredTerms` used; no fact or quote reused from an exemplar

## Error handling

- **`effectiveArticleConfig` missing / unconfigured (after the brand fallback):** STOP —
  ask the operator to set the review config for this series or its brand in the portal.
  No hardcoded default.
- **`get_writing_context` fails / unavailable:** proceed with the voice preset only and
  say so in the report.
- **Unknown tag value (no matching reference file):** list available reference files for
  that dimension and stop. Don't fall back to a default.
- **Transcript too short for a meaningful review** (<~500 words): flag it — the source may
  be incomplete.
- **Missing guest in transcript header:** cross-check the roster; if still ambiguous, ask
  — wrong attribution is worse than a placeholder.

## Extending the system

- **New review format:** add `references/format-<name>.md`; use the new value in a series'
  server-side review config. No SKILL.md change.
- **New editorial voice:** add `references/voice-<name>.md`; use the new value in the
  config. No SKILL.md change.
- **New tag dimension:** add the field to `effectiveArticleConfig`, create a
  `references/<dimension>-<value>.md` file, and add a load step in Step 2 — the only case
  that requires editing this SKILL.md.
