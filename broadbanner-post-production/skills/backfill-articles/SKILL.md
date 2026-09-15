---
name: backfill-articles
description: "Backfill a member's article archive from already-published Substack posts. Use when the user says 'backfill my articles', 'import my Substack posts', 'add these published articles to my archive', or provides one or more published post links (with an optional series name). For each link it opens the post, captures its title, publish date, and full content as markdown, and creates a PUBLISHED article via the BroadBanner MCP connector's create_article tool — organized under the named series, or the member's BRAND when no series is given. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Backfill Articles

Import a member's **already-published** Substack posts into their BroadBanner article
archive. Unlike the rest of the post-production chain (which generates an article from a
transcript), this skill takes **existing published articles** the member already has on
Substack and shelves them into the archive as **published** entries that link back to the
source post.

The member provides **one or more published post links** and, optionally, a **series
name**. When no series is given, the article is organized under the member's **brand**.

## Step 0 — Entitlement preflight (advisory)

This is a Post-Production Distribution add-on skill. Before any work, call
`get_creator_context` and, if it returns a capability summary indicating the member lacks
the `post_production_distribution` add-on, stop and point them at
`app.broadbanner.com/pricing/membership`. The `create_article` tool fails closed on the
server as the backstop, so this check is advisory (a friendlier message, not the gate).

## Inputs

| Input        | Required | Example                                              | Notes |
| ------------ | -------- | ---------------------------------------------------- | ----- |
| `links`      | Yes      | `https://sickofthis.substack.com/p/the-blockade`     | One or more **published** Substack post URLs (not draft/editor URLs). |
| `seriesName` | No       | `Palantalk`                                          | Human-readable series name. Omit → organize under the brand. |

## Single browser profile

This skill uses browser automation to read each published post. All BroadBanner Substack
browser skills run from the **single** connected Chrome profile (profile routing retired
2026-07-27). Use whatever BroadBanner browser is connected; the operator should be logged
into Substack in that browser so paywalled posts are readable.

## Step 1 — Resolve the destination (series or brand)

Call `get_creator_context` — it returns `{ contributorId, brand, brands?, pods, ...series }`.

- **A `seriesName` was given:** match it case-insensitively against the member's authorized
  series. Use `get_show_roster({ seriesId })` for each `pods` id and match on
  `roster.seriesTitle` (same resolution the `post-production` orchestrator uses). On a
  match, capture `seriesId`. Ambiguous / no match → list the candidate series titles and
  stop (don't guess).
- **No `seriesName`:** organize under the **brand**. Use `get_creator_context.brand`. If the
  member has multiple `brands` and it's unclear which, ask them to pick one; otherwise use
  the single brand. Capture `brandId` (the short brand id, e.g. `sotsp` / `babm`).

Every article created in this run uses the SAME destination (one `seriesId` **or** one
`brandId`, never both).

## Step 2 — For each link: capture the post

For each URL in `links`:

1. **Navigate** the connected browser to the published post URL.
2. **Capture:**
   - **Title** — the post's headline.
   - **Publish date** — the displayed date → normalize to `YYYY-MM-DD` (this becomes
     `episodeDate`).
   - **Full content** — the article body. Convert the rendered post HTML to clean
     **markdown**: keep headings, paragraphs, bold/italic, lists, block quotes, and links;
     drop Substack chrome (subscribe widgets, share bars, comment counts, "read in app",
     recommendation footers). Preserve the reading order. This markdown is the `bodyMd`.
3. If a post can't be read (private/removed/404), skip it and note it in the final report —
   don't fail the whole run.

## Step 3 — Create the article (published)

For each captured post, call `create_article`:

```
create_article({
  // destination — pass ONE:
  seriesId:    "<seriesId>",   // when a series was resolved
  // brandId:  "<brandId>",    // OR when organizing under the brand (no series)

  title:       "<post title>",
  bodyMd:      "<markdown content>",
  status:      "published",              // it's already published on Substack
  substackUrl: "<the post link>",        // powers the "Watch/Read on Substack" banner
  episodeDate: "<YYYY-MM-DD>",           // the post's publish date
})
```

`create_article` returns `{ ok, id, slug }` → the portal URL is
`https://app.broadbanner.com/app/articles/<slug>`.

Notes:
- Pass **`brandId`** only when there is no series; pass **`seriesId`** otherwise. Never both.
- `substackUrl` is the source link (the archive shows a "Read on Substack" banner above the
  body; reviews/articles don't embed video, so this routes readers to the post).
- Authorization is server-side: the member must host the series (series path) or be
  associated with the brand (brand path). A `403`/authorization error → stop and report.

## Step 4 — Report

Summarize what was imported:

```
Backfilled <N> article(s) into <seriesName or brand>:
  ✅ <title>  → app.broadbanner.com/app/articles/<slug>   (2026-08-01)
  ✅ <title>  → app.broadbanner.com/app/articles/<slug>   (2026-07-18)
  ⚠️  <url>   — skipped (couldn't read the post)
```

## Failure handling

- **Not entitled** (`create_article` authorization error): stop and report — the session
  isn't on the Post-Production Distribution add-on.
- **Bad link** (draft/editor URL instead of a published post, or a 404): skip that link,
  keep going, and list it as skipped.
- **Duplicate:** re-running with the same link creates another archive entry (slugs
  de-dupe with a suffix). If the member wants to avoid duplicates, have them check the
  archive first; this skill does not dedupe against existing articles.
