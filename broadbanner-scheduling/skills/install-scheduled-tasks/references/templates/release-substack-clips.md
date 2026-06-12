---
id: release-substack-clips-{{PROJECT_BASENAME}}
description: Release {{PROJECT_BASENAME}}'s queued video clips to Substack (list + post + mark, via the BroadBanner connector).
cronExpression: "*/30 9-21 * * *"
enabled: true
---

You are a recurring background poller running every ~30 minutes between 9am and 9pm local time, releasing this workspace's queued video clips to Substack. Invoke the `release-substack-clips` skill from the `broadbanner-social-distribution` plugin **for the `{{BRAND_SLUG}}` brand** — pass `brand: {{BRAND_SLUG}}` so it handles only this brand's clips and posts them to this brand's Substack account. This run is pre-approved to run autonomously — do NOT pause for per-clip confirmation.

Cadence note: video posts are slow and heavy, so this paces deliberately — the skill posts at most 2 clips per run and the `*/30` cron drips the rest out over the day rather than blast-posting. Widen the window or interval if you want fewer posts; the common case (nothing pending) fast-exits cheaply without opening a browser.

This **replaces the old `refill-clip-queue` + `drain-clip-queue` producer/consumer pair**. The local-queue split existed only because Cowork bash had no network — the MCP connector does, so the two collapse into this one self-contained task: it lists pending clips, posts each to Substack, and marks each released in one pass. No local queue, no `.creds/`, no `broadbanner.config.json`.

## What to do

Invoke `release-substack-clips`. It uses the **BroadBanner MCP connector** (the CLI path is retired):

1. Calls `list_pending_clips` with `brand: {{BRAND_SLUG}}` → only `{{BRAND_SLUG}}`'s pending clips. **If nothing is pending, it exits immediately** with a one-line "nothing pending" report — the common case, not an error. It does not open Substack.
2. Otherwise (oldest first, up to 2 per run): calls `get_creator_context` with `brand: {{BRAND_SLUG}}` for **this brand's** Substack handle, selects the Chrome profile logged into that handle, fetches each clip in-page from `media.broadbanner.com` and injects it into the Substack Notes composer (the `substack-video-note` technique — no download-to-disk, no 10 MB cap), posts it, then calls `mark_substack_posted` to flip that tracker's substack slot `pending → posted` (or `failed`). Any remainder goes out on the next run.

Because the queue and the account are both scoped to `{{BRAND_SLUG}}`, multiple brand workspaces can each run their own clip task with no double-drain — each sees only its own brand's clips.

These are the video clips from the restream-clip pipeline. **Bluesky and Threads for the same clips are handled separately — this task only touches Substack**, the one platform with no API.

## Prerequisites

- **The BroadBanner connector must be added and connected in Cowork** (Settings → Connectors → Add custom connector → `https://mcp.broadbanner.com/mcp` → sign in via WorkOS with the creator email). It provides identity, context, and the clip list — there are no local credentials. If the `list_pending_clips` / `get_creator_context` / `mark_substack_posted` tools aren't available, the connector isn't connected and the skill stops.
- The browser Cowork drives must be **logged into the creator's Substack** (the account = `substackHandle` from `get_creator_context`), or the post stops rather than go out under the wrong identity.
- **CORS must be configured on the media endpoint.** The skill fetches the clip from `media.broadbanner.com` inside the Substack composer, which requires `Access-Control-Allow-Origin: https://substack.com` on that endpoint. If missing, the skill marks the clip `failed` with `error: "media CORS not configured"` and moves on.

## Notes

- Close any browser tabs the post flow opened.
- A `failed` clip is not retried until reset to `pending` (flip its tracker's `platforms.substack.status` back to `pending` to re-release).
- Tune cadence via `cronExpression` (e.g. `*/15 8-22 * * *` to post more often, or widen the window).
