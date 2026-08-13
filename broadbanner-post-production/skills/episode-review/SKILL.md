---
name: episode-review
description: "Generate a publication-ready review from a corrected transcript, using the show's SERVER-SOURCED editorial config. Use when the user wants to write the review, episode writeup, or post-show summary, or after transcript-correction in the post-production chain. Reads reviewFormat / editorialVoice / reviewLength and more from the BroadBanner MCP connector's get_show_roster effectiveReviewConfig (NOT local config), loads only the matching format + voice references, and produces the review markdown + social copy. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Episode Review

Generate a publication-ready review from a corrected transcript. This skill reads the
show's **server-sourced** editorial config — the `effectiveReviewConfig` block from the
BroadBanner MCP connector's `get_show_roster` — to determine the review format and
editorial voice, loads only the relevant references, and produces the complete review
document plus social distribution copy.

**What's new vs. the legacy episode-pipeline review:** format, voice, length, takeaway
range, mode, and label come from the connector's `effectiveReviewConfig`, not from a local
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
the review as a portal DRAFT is the `review-publish` skill's job (there is no Pages/git
step in this plugin).

## Inputs

| Input                    | Required | Example                                             | Notes                                                            |
| ------------------------ | -------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Corrected transcript path| Yes      | `/tmp/post-production/babm-palan_e12-….txt`         | Output of transcript-correction                                  |
| Resolved series + roster | Yes      | `{ seriesId, seriesTitle, primaryHost, hosts[], guests[], effectiveReviewConfig }` | From the orchestrator's Step 0 (`get_show_roster`) |
| `episodeSlug`            | Yes      | `e12-surveillance-capitalism-and-you`               | For the output filename                                          |
| `episodeTitle`           | Rec.     | `Palantalk | E12 - Surveillance Capitalism and You` | The draft's title (SEO title source)                            |
| `episodeDate`            | Rec.     | `2026-03-31`                                        | For the SEO title / date suffix; default today if unknown        |

If the user just ran transcript-correction, carry these forward.

## Step-by-step workflow

### Step 1: Resolve the editorial config (server-sourced)

Use the `effectiveReviewConfig` from the resolved roster (the orchestrator already fetched
it; if you don't have it, call `get_show_roster({ showId })` / `({ seriesId })` and read
`roster.effectiveReviewConfig`). Extract:

- `reviewFormat` → the structural template tag (`summary` | `narrative` | `book-review` | …)
- `editorialVoice` → the tone tag (`data-fact` | `opinionated-fact` | `analytical-literary` | …)
- `reviewLength` → paragraph/sentence length guidance
- `takeawayCountRange` → how many key-takeaway bullets (summary format)
- `seasonBookMode` → `season` | `book` | `episodic` (affects labeling/title shape)
- `reviewLabel` → the human label for this review kind (carried into publish)

Also use the roster's `primaryHost`, `hosts[]`, `guests[]` for attribution, the signature
line, and `authorNames`.

**If `effectiveReviewConfig` is missing or `reviewFormat`/`editorialVoice` are empty:**
STOP and report — the show isn't configured for reviews on the server. Ask the operator to
set the review config for this series in the portal. Do NOT fall back to a hardcoded
default; explicit is better than implicit.

### Step 2: Load references by tag

Load exactly two reference files based on the resolved tags:

```
episode-review/references/format-<reviewFormat>.md
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

### Step 4: Generate the review

Follow both loaded references:

- **The format reference** controls structure: section order, required sections, length
  constraints, title format.
- **The voice reference** controls tone: attribution style, editorial stance, sentence
  construction, what to avoid.

Apply the server config as the binding constraints:

- Paragraph/sentence lengths per the format spec **and** the show's `reviewLength`.
- Key-takeaway count within the show's `takeawayCountRange` (summary format).
- Title shape appropriate to `seasonBookMode` — but the SEO title's episode label comes
  from the draft's `episodeTitle` (derived in transcript-download), not a local
  `titleFormat`. For episodic-mode shows there is no S/E numbering.
- **Quotes must be real** — every block/pull quote comes directly from the transcript.
  Paraphrase-and-attribute if unclear; never invent.
- Book links (book-review format): publisher > independent bookstore > thrift; no large
  tech-company bookstores.

Produce the review body **and** the social distribution copy (Substack blurb, Bluesky
post ≤300 chars, YouTube description) per the format reference's Social Distribution Copy
section. Keep the social copy as a distinct block — `review-publish` passes it to
`create_review` as `socialCopy`.

### Step 5: Save the output

Save the review markdown to:

```
/tmp/post-production/<seriesId>_review_<episodeSlug>.md
```

The markdown is the intermediate deliverable that `review-publish` reads and pushes to the
portal — there is no Pages directory or git write in this plugin.

### Step 6: Report to the user

Present:

- Path to the saved review file
- The SEO title and subtitle for quick confirmation
- The block quote (narrative/book-review) or the takeaway bullets (summary) for a quality
  check
- Config used: `reviewFormat: <value>`, `editorialVoice: <value>`, `reviewLabel: <value>`
- `authorNames` derived from the roster (primary host + hosts)
- Next: "Review ready. Next: review-publish (push as a portal DRAFT)."

**Carries forward:** `reviewPath`, `seoTitle`, `subtitle`, `bodyMd` (the review body
markdown), `socialCopy`, `reviewLabel`, `authorNames`.

## Output quality checks

Before delivering, verify:

- [ ] SEO title reflects the draft's episode title + date
- [ ] Body meets the paragraph/sentence requirements for the loaded format and `reviewLength`
- [ ] Takeaway count (if applicable) is within `takeawayCountRange`
- [ ] All quotes come directly from the transcript
- [ ] No fabricated timestamps, sources, or events
- [ ] Lists are 2-5 items
- [ ] Book links (if any) follow the linking policy
- [ ] Social distribution copy is present (Substack, Bluesky, YouTube)
- [ ] Speaker attribution matches the live roster (primary host / hosts / guests)
- [ ] Editorial voice matches the loaded voice reference

## Error handling

- **`effectiveReviewConfig` missing / unconfigured:** STOP — ask the operator to set the
  review config for this series in the portal. No hardcoded default.
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
- **New tag dimension:** add the field to `effectiveReviewConfig`, create a
  `references/<dimension>-<value>.md` file, and add a load step in Step 2 — the only case
  that requires editing this SKILL.md.
