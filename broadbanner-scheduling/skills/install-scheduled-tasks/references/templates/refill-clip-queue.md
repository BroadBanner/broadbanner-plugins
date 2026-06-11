---
id: refill-clip-queue-{{PROJECT_BASENAME}}
description: Pull {{PROJECT_BASENAME}}'s pending Substack clips from the Gateway into the local queue.
cronExpression: "7 9-21 * * *"
enabled: true
---
You are a recurring background task running hourly (at :07, 9am–9pm local) that refills this workspace's local Substack clip queue from the hosted system. Invoke the `refill-clip-queue` skill from the `broadbanner-social-distribution` plugin. This run is pre-approved to run autonomously — do NOT pause for confirmation.

This is the **producer** half of the pipeline: it fetches clips and writes local pending pointers. The **`drain-clip-queue`** task (every ~30m) is the consumer that actually posts them. Install both.

## Workspace pin

Before invoking the skill, verify `{{PROJECT_ROOT}}` is the active Cowork project root. If it is not, call `request_cowork_directory` with `{{PROJECT_ROOT}}` and wait. The skill resolves `.creds/gateway.token` + `.creds/userid`, the queue directory, and `clipQueue` config against the active project — without this pin it uses the wrong workspace and credentials.

## What to do

Invoke `refill-clip-queue`. It:

1. Reads `{{PROJECT_ROOT}}/.creds/gateway.token` + `userid` (local file reads).
2. Calls the Gateway `GET /v1/posts?source=restream-clip&platform=substack&status=pending` via an **in-browser `javascript_tool` fetch** against `gateway.broadbanner.com` — Cowork bash has no outbound network, so the call must go through a browser tab (same-origin), exactly like `substack-note`'s ingest.
3. Hands the result to `pull-clip-queue.mjs`, which queues up to `limit` of the newest eligible clips, dedups permanently against what's already been queued, skips clips older than `maxAgeDays`, and writes a local `*_restream-clip_*.json` pointer per clip with `release_at` staggered ~30 min apart (timezone-safe elapsed offsets, no wall-clock window). `drain-clip-queue`'s cron (in your local timezone) enforces the actual 9am-9pm window and posts one per tick.

It never opens Substack and never posts — that's `drain-clip-queue`'s job.

## Limiter & mode

Rate control comes from the `clipQueue` block in `broadbanner.config.json` (defaults: `limit: 5`, `maxAgeDays: 30`). Each run queues up to `limit` of the newest eligible clips, skips anything older than `maxAgeDays`, and dedups permanently — no mode or baseline to set. Posting cadence and the time-of-day window are the `drain-clip-queue` cron's job (`*/30 9-21` in your local timezone), not this task's.

## Pod authorization

Authorized pods: {{POD_IDS}}. The pull script only writes clips whose `clip.pod_id` is in `user.effectivePodIds`, so off-pod clips never enter the queue. For a multi-brand host hub this list spans every show the user hosts across brands — one queue, fed from all of them.

## Prerequisites

- `{{PROJECT_ROOT}}/.creds/gateway.token` must carry the `posts:read` capability, and `{{PROJECT_ROOT}}/.creds/userid` must hold the caller's BannerBlast user UUID. Both are auto-issued by **`banner-blast init`** (creator/contributor/admin presets include `posts:read` as of `@broadbanner/core` v1.29.0) — no admin tooling. If the Gateway fetch returns `403 Missing capability: posts:read`, the token is stale: re-run `banner-blast init` (with the latest `banner-blast`) to re-issue. Note init only re-issues when it can reach the signing key — if it can't, it keeps the old token, so verify the re-issue took.
- The caller must be enrolled in the BannerBlast Worker with `pods[]` covering the shows they host — per-user fan-out only delivers clips to enrolled users.

## Notes

- Close the Gateway browser tab when done.
- If the fetch fails (`fetch failed`), confirm the call ran **in a browser tab on gateway.broadbanner.com**, not in bash — bash has no network in Cowork.
- Tune cadence via `cronExpression` (e.g. `*/30 9-21 * * *` to refill more often).
