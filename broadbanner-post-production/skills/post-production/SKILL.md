---
name: post-production
description: "Turn a finished Substack live draft into an editable article DRAFT in the member portal — from just two inputs. Use when the user says 'run post-production', 'process this show', 'write the review for this live', or provides a Substack draft URL plus a series name. Resolves the series, brand, roster, and editorial config LIVE via the BroadBanner MCP connector, then chains transcript download → correction → review generation → portal publish. The operator supplies ONLY the draft URL and series name; everything else is derived. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Post-Production (orchestrator)

Run the complete post-production chain from a finished Substack **live draft** to an
**editable article DRAFT** in the member portal (`app.broadbanner.com/app/articles/<slug>`).
This skill orchestrates four standalone skills in sequence, carrying context forward.

This is the successor to the retired `episode-pipeline` orchestrator. The critical
difference is the **trigger contract**: the old pipeline read a local
`broadbanner.config.json` / `pod-map.json` and took episode id / date / guests / format /
voice as inputs. This skill derives **all of that** from two inputs, resolving everything
live through the **BroadBanner MCP connector** (server `broadbanner`).

## The trigger contract (read this first)

The operator provides **exactly two inputs**:

| Input        | Required | Example                                                  | Notes                                                        |
| ------------ | -------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `draftUrl`   | Yes      | `https://sickofthis.substack.com/publish/post/192891809` | The Substack **draft** editor URL for the just-finished live |
| `seriesName` | Yes      | `Palantalk`                                              | The human-readable series name, as the operator types it     |

Do **not** ask for an episode number, date, guest list, review format, editorial voice,
series id, or brand. Every one of those is resolved for you below. If the user offers
extra hints (e.g. a guest name), you may carry them as confirmation, but never *require*
them — the roster and editorial config are authoritative.

## What this skill does

It contains no processing logic itself. It coordinates four skills in order, passing
outputs forward as inputs. Each skill has its own `SKILL.md` — read that skill's
instructions when you reach its step.

```
Step 0  Resolve the series (get_creator_context + get_show_roster)
Step 1  transcript-download   → derive slug/title/date from the draft, download the .txt
Step 2  transcript-correction → correct against the LIVE roster (get_show_roster)
Step 3  episode-review        → generate review + social copy using effectiveArticleConfig
Step 4  article-publish        → create_article → editable DRAFT in the portal
```

## Step 0 — Entitlement preflight + series resolution

This skill is declared `metadata.requiresTool: post_production_distribution`. Do Step 0a
before any browser work.

### Step 0a — Entitlement preflight (advisory)

Call `get_creator_context`. If it returns a capability summary
(`entitledTools` / `caps` / `tier` / `isAdmin`), confirm the caller holds the add-on:
`post_production_distribution` ∈ `entitledTools` (or the equivalent
`post_production:*` cap ∈ `caps`), or `isAdmin`. If those fields are present and none
holds, **stop** with the CTA below before any browser work. If the context omits the
fields (older connector), proceed — the connector's `get_show_roster` / `create_article`
tools fail closed as the backstop.

> ⚠️ Post-production publishing is the **Production+** add-on
> (`post_production_distribution`, $5/mo). Your account isn't entitled yet — add it from
> your member portal → https://app.broadbanner.com/pricing/membership. Nothing was
> generated or published.

### Step 0b — Resolve the series from `seriesName`

`get_creator_context` returns `{ contributorId, substackHandle, brand, brands?, pods: [...] }`.
`pods` is the list of series ids the creator is authorized for. Resolve the operator's
typed `seriesName` to a single series **by matching against each series' live title**:

1. For **each** series id in `pods`, call `get_show_roster({ seriesId })`. Collect the
   returned `roster` objects — each carries `seriesId`, `seriesTitle`, `brandId`,
   `primaryHost`, `hosts[]`, `guests[]`, and `effectiveArticleConfig`.
2. Match `seriesName` against `roster.seriesTitle` **case-insensitively** (trim
   whitespace; ignore surrounding punctuation). Prefer an exact case-insensitive equality;
   fall back to a unique containment match only if no exact match exists.
3. **Resolution outcomes:**
   - **Exactly one match** → that roster is the resolved series. Capture
     `{ seriesId, seriesTitle, showId, brandId, primaryHost, hosts, guests, effectiveArticleConfig }`
     and carry all of it forward. This is the single source of truth for the rest of the run.
   - **No match** → **stop.** List the candidate series titles the creator hosts and ask
     the operator to re-type the series name (or fix the spelling):
     ```
     No series matches "<seriesName>". You host:
       - <seriesTitle A>
       - <seriesTitle B>
       - …
     Re-run with one of these series names.
     ```
   - **Ambiguous (2+ matches)** → **stop.** List the matching series titles and ask the
     operator to disambiguate. Never guess.

> The resolved roster's `showId` is the specific show instance for this review — pass it
> through to `get_show_roster` re-calls (via `showId`) and to `create_article`
> (`showId`, so the portal ties the review to the correct show). If the roster carries no
> `showId` (series-level only), fall back to `seriesId` everywhere and omit `showId` on
> publish.

Announce the resolved series before proceeding, e.g. `Resolved "Palantalk" →
seriesId=babm-palan, brand=babm, format=summary, voice=data-fact.`

## Step 1 — Transcript Download

**Skill:** `../transcript-download/SKILL.md`

**Purpose:** Download the raw transcript `.txt` from the Substack draft, **deriving the
episode slug/title/date from the draft's own post title** — not from any local config.

**Carry in:** `draftUrl`, resolved `{ seriesId, seriesTitle, brandId, showId }`.

**Carries forward:** `transcriptPath` (local `.txt`), `episodeSlug`, `episodeTitle`,
`episodeDate` (all derived from the post), raw line count.

## Step 2 — Transcript Correction

**Skill:** `../transcript-correction/SKILL.md`

**Purpose:** Two-phase correction. Phase 0 calls `get_show_roster` for the resolved
series/show and merges the **live** primary-host / host / guest names into BOTH the
deterministic name-normalization pass AND the AI speaker-attribution pass — instead of
relying only on the static `corrections-dictionary.json`. The self-learning dictionary
append is preserved for genuinely new spellings.

**Carry in:** `transcriptPath`, resolved `{ seriesId, showId, seriesTitle }`,
`episodeSlug`, `episodeTitle`, `episodeDate`, and (from the roster you already have)
`primaryHost`, `hosts[]`, `guests[]` so the skill needn't re-call unless it wants to
refresh.

**Carries forward:** corrected `transcriptPath` (overwrites in place), confirmed speaker
names, any flagged sections.

## Step 3 — Episode Review

**Skill:** `../episode-review/SKILL.md`

**Purpose:** Generate the publication-ready review markdown + social copy using the
**server-sourced** `effectiveArticleConfig` from the resolved roster — `articleFormat`
(structural template), `editorialVoice` (tone), `articleLength`, `takeawayCountRange`,
`seasonBookMode`, and `articleLabel` — instead of any local `broadbanner.config.json`.

**Carry in:** corrected `transcriptPath`, resolved `{ seriesId, seriesTitle, primaryHost,
hosts, guests, effectiveArticleConfig }`, `episodeSlug`, `episodeTitle`, `episodeDate`.

**Carries forward:** `reviewPath` (markdown), `seoTitle`, `subtitle`, `bodyMd`,
`socialCopy`, `articleLabel`, `authorNames` (from `primaryHost` / `hosts`).

## Step 4 — Review Publish

**Skill:** `../article-publish/SKILL.md`

**Purpose:** Push the generated markdown as an **editable DRAFT** into the member portal
via the `create_article` connector tool, and return the portal URL. **No git, no Pages.**

**Carry in:** everything from Step 3 plus `seriesId`, `showId`, `episodeDate`.

**Carries forward:** `{ ok, id, slug, url }` from `create_article` — the
`https://app.broadbanner.com/app/articles/<slug>` URL for the member to review/edit/publish.

## After the chain completes

Report the full summary:

```
Post-production complete for <seriesTitle> — <episodeTitle>

Resolved:    seriesId=<seriesId>, brand=<brandId>, show=<showId or series-level>
Config:      format=<articleFormat>, voice=<editorialVoice>, label=<articleLabel>
Transcript:  <transcriptPath> (<line count> lines) — corrected against live roster
             (primary host <name>; hosts <…>; guests <…>)
Review:      <reviewPath>
Published:   DRAFT → <url>

Next: open the review in the portal to edit and publish. It is a DRAFT — nothing is
public until you publish it there.
```

## Resuming from a step

If the user says "start from correction" or "just regenerate the review," skip the earlier
steps and pick up the chain. You still need Step 0's resolution (the roster + config), so
run Step 0 regardless — it's a cheap connector call and it's the source of truth every
later step depends on. Then:

| Resume from            | What you need                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| Step 1 (download)      | `draftUrl` + browser logged into Substack                        |
| Step 2 (correction)    | `transcriptPath` (the raw `.txt`)                                 |
| Step 3 (review)        | the corrected `transcriptPath`                                    |
| Step 4 (publish)       | `reviewPath` (the generated markdown) + `seriesId` / `showId`    |

## Error handling

- **Series not resolved (no/ambiguous match):** handled in Step 0b — list candidates and
  stop. Never guess a series.
- **Entitlement absent:** Step 0a stops with the membership CTA before any work.
- **A connector tool returns an authorization error:** the session isn't entitled to
  `post_production_distribution` (or lacks a scheduling/creator role for this series).
  Stop and report — there is no direct-API fallback.
- **Step failure:** report which step failed and why. The user can fix and resume with
  "start from step N" — Step 0's resolution re-runs cheaply each time.
- **Browser not available:** Step 1 needs browser access to the Substack editor. If the
  browser isn't connected, report: "Step 1 needs browser access to the Substack draft.
  Connect Chrome (logged into Substack) and re-run."
- **Transcript too short:** if the downloaded transcript is under ~100 lines, warn — the
  download may have failed or the recording is very short.
