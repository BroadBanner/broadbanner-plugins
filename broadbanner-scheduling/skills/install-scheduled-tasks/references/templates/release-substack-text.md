---
id: release-substack-text-{{PROJECT_BASENAME}}
description: Release {{PROJECT_BASENAME}}'s web-composed text posts to Substack (poll + post + mark).
cronExpression: "*/2 * * * *"
enabled: true
---

You are a recurring background poller running every ~2 minutes, around the clock, that releases this workspace's web-composed text posts to Substack with near-queue parity (Bluesky/Threads post within 0–3 min via the Worker queue; this keeps Substack close behind). Invoke the `release-substack-text` skill from the `broadbanner-social-distribution` plugin. This run is pre-approved to run autonomously — do NOT pause for confirmation.

Cadence note: Substack has no API, so release is browser automation on a poll — it can't be event-driven like the Worker queue. `*/2` keeps the lag short; the common case (nothing pending) fast-exits cheaply. Widen the interval (e.g. `*/5 9-21 * * *`) if the run volume is more than you want; tighten toward `* * * * *` for the absolute minimum lag.

Unlike the clip pipeline (a `refill-clip-queue` producer + `drain-clip-queue` consumer pair), text release is a **single self-contained task**: it polls the Gateway, posts to Substack, and marks each post released all in one pass — there is no local queue to fill. Install just this one task.

This spec is brand-agnostic: it works for a single-brand workspace and a multi-brand contributor hub without edits — the Substack profile and identity both come from `broadbanner.config.json` + the workspace token at run time.

## Workspace pin

Before invoking the skill, verify `{{PROJECT_ROOT}}` is the active Cowork project root. If it is not, call `request_cowork_directory` with `{{PROJECT_ROOT}}` and wait for confirmation. The skill resolves `.creds/gateway.token`, the Substack handle, and the Chrome profile against the active project — without this pin it uses the wrong workspace and credentials.

## What to do

Invoke `release-substack-text`. It:

1. Reads `{{PROJECT_ROOT}}/.creds/gateway.token` (a local file read). It does **not** need `.creds/userid` — the endpoints resolve the creator from the token subject.
2. Calls the Gateway `GET /v1/creators/pending-substack` via an **in-browser `javascript_tool` fetch** against `gateway.broadbanner.com` — Cowork bash has no outbound network, so the call must go through a browser tab (same-origin), exactly like `substack-note`'s ingest.
3. If nothing is pending, it exits immediately with a one-line "nothing pending" report. This is the common case — not an error. It does not open Substack.
4. Otherwise, for each pending post (oldest first, up to 5 per run): it posts the text to Substack via browser automation (the same composer flow as `substack-note`), then calls `POST /v1/creators/mark-substack` to flip that tracker's substack slot `pending → posted` (or `failed` if the post didn't confirm). Any remainder beyond 5 goes out on the next run.

These are the text posts created from the BannerBlast web composer (`#blastItButton`), which ingests them with `substack: pending`. **Bluesky and Threads for the same posts are handled separately by the BannerBlast Worker queue (server-side, via API) — this task only touches Substack**, the one platform with no API.

## Prerequisites

- `{{PROJECT_ROOT}}/.creds/gateway.token` must carry both `posts:read` (to list pending) and `posts:write` (to mark released). Both are auto-issued by **`banner-blast init`** (creator/contributor/admin presets) — no admin tooling. If the Gateway fetch returns `403 Missing capability`, the token is stale: re-run `banner-blast init` with the latest `banner-blast` to re-issue. Init only re-issues when it can reach the signing key — if it can't, it keeps the old token, so verify the re-issue took.
- The Chrome profile resolved from `chromeProfiles.byBrand[{{BRAND_SLUG}}]` must be logged in to the matching Substack account (Notes handle = `user.substackUsername`), or the post stops rather than go out under the wrong identity.

## Notes

- Close the browser tabs the flow opened when done.
- If the fetch fails (`fetch failed`), confirm the call ran **in a browser tab on gateway.broadbanner.com**, not in bash — bash has no network in Cowork.
- A post that fails verification is marked `failed` (not retried forever). To re-release a `failed` post after fixing the issue, flip its tracker's `platforms.substack.status` back to `pending`.
- Tune cadence via `cronExpression` (e.g. `*/30 9-21 * * *` to release less often, or widen the window).
