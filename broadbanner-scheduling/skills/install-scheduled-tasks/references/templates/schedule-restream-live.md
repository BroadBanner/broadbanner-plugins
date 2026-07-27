---
id: schedule-restream-live-{{PROJECT_BASENAME}}
description: Run the restream-schedule-live skill daily for {{BRAND_DISPLAY}} — pairs Substack channels and schedules draft Restream events.
cronExpression: 0 4 * * *
enabled: true
---
You are running on a daily ~4:00am schedule on the operator's **local machine**, AFTER the substack-live task has already captured stream keys and scheduled shows on Substack. Invoke the `restream-schedule-live` skill from the `broadbanner-live-production` plugin. This run is pre-approved to run autonomously — do NOT pause for per-show confirmation.

## ⚠️ Local machine only — cannot run in the cloud

This task drives **Restream Studio in a local Chrome browser** through the Claude-in-Chrome connection. It **cannot** run on a cloud/headless agent — schedule it on a machine where the single BroadBanner Chrome profile is open and logged in to Restream Studio (`app.restream.io`) at fire time. If no browser is connected, the skill stops and reports; nothing is scheduled.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on a session authorized to schedule (brand-admin / super-admin today). The skill is **connector-only** — no `broadbanner.config.json`, no `.creds/gateway.token`, no `BROADBANNER_ENC_PASSPHRASE`, no mount.
- The **single connected** BroadBanner Chrome profile logged in to Restream Studio. There is no profile routing — the skill uses whatever browser is connected.
- The matching Substack channel must already exist in Restream — provisioned by the **Restream-Worker** channel-sync pass.

## What to do

Invoke the skill; it fetches show data via the connector and handles the Restream Studio automation internally.

1. Calls `list_schedulable_shows({ states: ["substack_scheduled", "restream_paired"] })` via the connector.
2. Filters shows already scheduled on Substack with a non-null stream key.
   - **Brand isolation:** ALSO require the show's `podId` starts with `{{POD_PREFIX}}` ({{BRAND_DISPLAY}} series: {{POD_IDS}}). Never process shows from other brands.
3. Applies the default 7-day scheduling horizon and excludes shows already scheduled in Restream (`list_restream_events`).
4. If no eligible shows remain, exit quietly ("No shows ready for Restream scheduling"). This is the common case — not an error.
5. Otherwise automate Restream Studio (find the draft event by title, set date/time, pair the Substack channel, click Schedule) and write the result back via `upsert_restream_event`.

## Notes

- Only schedule Draft events; never touch events already in Scheduled or Live status.
- If no draft event matches a show's title, skip that show and note it in the report.
- Process shows one at a time, completing each fully before moving to the next.
