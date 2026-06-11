---
id: drain-clip-queue-{{PROJECT_BASENAME}}
description: Post one due Substack video-note from the {{PROJECT_BASENAME}} local clip queue per run.
cronExpression: "*/30 9-21 * * *"
enabled: true
---
You are a recurring background poller running every ~30 minutes between 9am and 9pm local time, posting this workspace's already-queued clips to Substack. Invoke the `drain-clip-queue` skill from the `broadbanner-social-distribution` plugin. This run is pre-approved to run autonomously — do NOT pause for per-clip confirmation.

This is the **post** half of the pipeline; the **`refill-clip-queue`** task is the producer that fills the queue. This task is local-only — it never calls the Gateway. Install both; one without the other does nothing useful.

This spec is brand-agnostic: it works for a single-brand workspace and for a multi-brand contributor hub without edits — the authorized pods and the Substack profile both come from `broadbanner.config.json` at run time.

## Workspace pin

Before invoking the skill, verify `{{PROJECT_ROOT}}` is the active Cowork project root. If it is not, call `request_cowork_directory` with `{{PROJECT_ROOT}}` and wait for confirmation. Without this pin the skill inherits whatever project is focused and drains the wrong workspace.

## What to do

Invoke `drain-clip-queue`. It is a minimum-cost, **local-only** dispatcher:

1. Scans `{{PROJECT_ROOT}}/Social-Distribution/` for `*_restream-clip_*.json` trackers whose `platforms.substack.status` is `pending` and whose `release_at` has passed.
2. If none are due, it exits immediately with a one-line "nothing due" report. This is the common case — not an error. Do nothing further. An empty queue just means the refill task hasn't pulled anything new yet.
3. Otherwise it picks the single oldest-due clip, soft-locks it (`queued`), and invokes `substack-video-note` to post it. Exactly one clip per run — so this 30-minute cron is what paces posting (one clip per tick, 9am-9pm local), dripping clips out rather than blast-posting.

## Pod authorization

This workspace's authorized pods are: {{POD_IDS}}. The refill that writes the queue enforces this (it only writes clips whose `clip.pod_id` is in `user.effectivePodIds`), so off-pod clips never reach the local queue. For a single-brand workspace these are that brand's pods; for a personal host hub they span every show the user hosts across brands.

## Prerequisites

- The queue is filled by the `refill-clip-queue` scheduled task — install that too, or this drains an empty folder forever.
- `substack-video-note` resolves the Chrome profile per clip from `chromeProfiles` (`byPodId` → `byBrand` → `default`). A contributor posting every hosted show to one personal account just needs `chromeProfiles.default`; a workspace splitting brands across accounts maps `byBrand`/`byPodId`. That resolved profile must be logged in to the matching Substack account (Notes handle = `user.handle`), or the post stops rather than go out under the wrong identity.
- **CORS must be configured on the media endpoint.** `substack-video-note` fetches the clip from `media.broadbanner.com` inside the Substack composer; this requires `Access-Control-Allow-Origin: https://substack.com` on that endpoint. If missing, the skill marks the clip `failed` with `error: "media CORS not configured"` and moves on — fix the header before expecting posts to land.

## Notes

- Close any browser tabs the post flow opened.
- A `failed` clip is left as-is and not retried until reset to `pending`. To re-queue failures after fixing an issue, flip their `platforms.substack.status` back to `pending`.
- Tune `cronExpression` to change cadence (e.g. `*/15 8-22 * * *` to post more often).
