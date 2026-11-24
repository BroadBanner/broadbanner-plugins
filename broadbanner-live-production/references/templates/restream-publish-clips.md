---
id: restream-publish-clips-{{PROJECT_BASENAME}}
description: Publish {{PROJECT_BASENAME}}'s next Restream clip to TikTok and YouTube (one per run, via the BroadBanner connector and Restream's clips UI).
cronExpression: "0 * * * *"
enabled: true
runLocation: local
---

You are an hourly background run that publishes this workspace's next Restream clip. Invoke the `restream-publish-clip` skill from the `broadbanner-live-production` plugin with no `brand` argument. This run is pre-approved to run autonomously: do NOT pause for confirmation.

## Runs on this computer

Publishing is browser automation in Restream's clips UI. The clip's Restream account picks the browser: Banner and Backbone Media in the Claude built-in browser, other accounts in Chrome (Claude in Chrome). That browser must be signed in to the account at fire time and the computer awake. The skill checks who is signed in and stops, publishing nothing, on the wrong account or a login page. It never switches browsers or accounts.

## What the skill does

1. Calls `list_pending_restream_clips`. **Nothing waiting → it exits at once** without opening a browser. That is the common case, not an error.
2. Outside 10:00–22:59 ET it exits too, so clips never go out overnight.
3. Otherwise it publishes **one** clip, the oldest, then records it with `mark_restream_published`. One clip per hourly run keeps posts at least an hour apart; a backlog drains over the day.

Only clips Restream made after the feature's start date are ever listed (no backfill), never a co-host's copy, and never a series whose auto-posting is set to Manual.

## Prerequisites

- The BroadBanner connector connected (it provides the clip list and records results; there are no local files or credentials).
- The clip's Restream account signed in in its browser (see above).

## Notes

- A `failed` clip is not retried automatically. Publish it by hand in Restream if it should still go out.
- Close only the tabs the run opened.
