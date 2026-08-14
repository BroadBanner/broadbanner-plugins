---
name: article-publish
description: "Push a generated article markdown into the member portal as an editable DRAFT via the BroadBanner MCP connector's create_article tool. Use when the user says 'publish the review', 'push it to the portal', 'create the article draft', or after episode-review completes in the post-production chain. Returns the app.broadbanner.com/app/articles/<slug> URL for the member to review, edit, and publish. NO git, NO GitHub Pages — this replaces the old pages-publish flow. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Review Publish

Push a completed review markdown into the member portal as an **editable DRAFT** by calling
the BroadBanner MCP connector's `create_article` tool, then return the portal URL so the
creator can review, edit, and publish it themselves. This is the final step of the
post-production chain.

**This replaces the legacy `pages-publish` skill.** There is **no git, no branch, no
commit, no GitHub PR, no Jekyll formatting, no `Pages/` write.** The review lands as a
draft in `app.broadbanner.com/app/articles/…`, and the member owns the publish action.

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: post_production_distribution`. Call
`get_creator_context`; if it returns a capability summary
(`entitledTools` / `caps` / `isAdmin`), confirm the add-on is present (or `isAdmin`),
otherwise stop with the CTA. If the fields are omitted (older connector), proceed — the
`create_article` tool fails closed as the backstop. When invoked by the `post-production`
orchestrator, this has already run — don't repeat it.

> ⚠️ Post-production is the **Production+** add-on (`post_production_distribution`, $5/mo).
> Your account isn't entitled yet — add it from https://app.broadbanner.com/pricing/membership.
> Nothing was published.

## Inputs

| Input          | Required | Example                                             | Notes                                                          |
| -------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `reviewPath`   | Yes      | `/tmp/post-production/babm-palan_review_e12-….md`   | The markdown produced by episode-review                       |
| `seriesId`     | Yes      | `babm-palan`                                        | From the orchestrator's Step 0 resolution                     |
| `showId`       | Rec.     | `show-abc-123`                                      | Ties the review to the specific show instance. Omit if series-level only |
| `episodeTitle` | Rec.     | `Palantalk | E12 - Surveillance Capitalism and You` | Source of the review `title`                                  |
| `episodeDate`  | Rec.     | `2026-03-31`                                        | → `episodeDate`                                                |
| `articleLabel`  | Rec.     | `Palantalk In Review`                               | From `effectiveArticleConfig` → `articleLabel`                  |
| `authorNames`  | Rec.     | `["Nick Paro"]`                                     | From the roster (primary host + hosts) → `authorNames`        |

If the user just ran episode-review, carry these forward.

## Step-by-step workflow

### Step 1: Read and validate the review

Read the article markdown at `reviewPath`. Parse out:

- **`title`** — the SEO title / H1 (strip a trailing ` - YYYY/MM/DD` date suffix if the
  format appended one; the portal shows the date separately via `episodeDate`).
- **`subtitle`** — the Subtitle / Pages-H2 line, if present.
- **`bodyMd`** — the review body markdown (block quote + review section + any Books
  Mentioned / Key Takeaways / Sources sections). This is the article body the portal
  stores and renders.
- **`socialCopy`** — the Social Distribution Copy block (Substack blurb / Bluesky post /
  YouTube description), if present.

**Validate** before publishing:

- `title` is present and non-empty
- `bodyMd` is present and non-empty (at least the review section)

**If validation fails:** STOP and report exactly what's missing. Do not push a partial
review. Suggest re-running `episode-review`.

### Step 2: Build the `create_article` call

Assemble the arguments for the connector tool:

```
create_article({
  seriesId:      "<seriesId>",              // required
  title:         "<title>",                 // required
  bodyMd:        "<bodyMd>",                // required — the review body markdown
  showId:        "<showId>",                // optional — ties to the show instance; omit if none
  slug:          "<episodeSlug>",           // optional — let the server slug from title if omitted
  subtitle:      "<subtitle>",              // optional
  articleLabel:   "<articleLabel>",           // optional — the review-kind label
  authorNames:   ["<host names>"],          // optional — from the roster
  episodeDate:   "<episodeDate>",           // optional — YYYY-MM-DD
  coverImageUrl: "<url>",                   // optional — omit unless you have one
  socialCopy:    "<socialCopy>",            // optional — the social distribution block
})
```

Only pass the fields you actually have — omit optionals rather than sending empty strings.
The review is created as a **DRAFT**; `create_article` does not publish it.

### Step 3: Call the tool and capture the result

Call `create_article(...)`. On success it returns:

```json
{ "ok": true, "id": "review-…", "slug": "<slug>", "url": "https://app.broadbanner.com/app/articles/<slug>" }
```

- On a transient/`5xx` error, retry up to 3× with brief backoff (500 ms → 1 s → 2 s).
- On an **authorization error**, stop — the session isn't entitled to
  `post_production_distribution`. There is no direct-API / Pages fallback.
- On a **request-shape error** (missing required field, bad `seriesId`/`showId`), fail
  loud with the message; do NOT retry blindly. Fix the argument and re-call.

### Step 4: Report to the user

Present:

- **The portal URL** — `url` from the response (`https://app.broadbanner.com/app/articles/<slug>`)
- The review `title` and the fact that it is a **DRAFT** (nothing is public yet)
- The `seriesId` / `showId` it's tied to
- A note that the social copy (if any) was attached for reuse when distributing

```
Review published as a DRAFT — nothing is public until you publish it in the portal.

Title:  <title>
Series: <seriesId>  (show: <showId or series-level>)
Draft:  <url>

Open the draft to edit and publish. Social copy is attached for distribution.
```

## Error handling

- **Review file not found:** ask for the correct path; suggest running `episode-review` first.
- **Validation fails (missing title/body):** report exactly what's missing; do not publish
  a partial review.
- **`create_article` authorization error:** the session isn't entitled — stop and report.
  No Pages/git fallback exists in this plugin.
- **`create_article` request-shape error:** fail loud; fix the offending argument (usually a
  bad `seriesId`/`showId` or an empty required field) and re-call. Don't retry blindly.
- **`create_article` transient error:** retry up to 3× with backoff, then report the failure
  — the article markdown is still on disk at `reviewPath`, so the user can re-run this skill.

## Why no git / Pages

The old `pages-publish` skill wrote a Jekyll file into the `Pages/` repo, updated an
`index.md`, and opened a GitHub PR. This plugin publishes to the D1-backed member portal
instead: `create_article` stores the review as a draft the creator edits and publishes from
`app.broadbanner.com`. No local repo, no branch, no PR, no Pages deploy wait — the creator
sees the draft immediately and owns the publish decision.
