---
id: schedule-restream-live-{{PROJECT_BASENAME}}
description: Run the restream-schedule-live skill daily for {{BRAND_LABEL}} — pairs Substack channels and schedules draft Restream events.
cronExpression: 0 4 * * *
enabled: true
runLocation: local
---
<!-- Pre-Production Assistant (Production+ add-on, pre_production_assistant / cap scheduling:auto): the unattended auto-scheduling of Restream lives. -->
You are running on a daily ~4:00am schedule on the operator's **local machine**, AFTER the substack-live task has already captured stream keys and scheduled shows on Substack. Invoke the `restream-schedule-live` skill from the `broadbanner-live-production` plugin. This run is pre-approved to run autonomously — do NOT pause for per-show confirmation.

## ⚠️ Local machine only — cannot run in the cloud

This task drives **Restream Studio in a local Chrome browser** through the Claude-in-Chrome connection. It **cannot** run on a cloud/headless agent — schedule it on a machine where the single BroadBanner Chrome profile is open and logged in to Restream Studio (`app.restream.io`) at fire time. If no browser is connected, the skill stops and reports; nothing is scheduled.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on a session authorized to schedule (brand-admin / super-admin today). The skill is **connector-only** — no `broadbanner.config.json`, no `.creds/gateway.token`, no `BROADBANNER_ENC_PASSPHRASE`, no mount.
- The **single connected** BroadBanner Chrome profile logged in to Restream Studio. There is no profile routing — the skill uses whatever browser is connected. One Restream login covers **every workspace** on the account: the skill groups shows by workspace and switches between them in the Restream left sidebar within that single session.
- The matching Substack channel must already exist in Restream — provisioned by the **Restream-Worker** channel-sync pass.

## What to do

Invoke the skill; it fetches show data via the connector and handles the Restream Studio automation internally.

1. Calls `list_schedulable_shows({ states: ["substack_scheduled", "restream_paired", "restream_scheduled"] })` via the connector (the last state is fetched only to verify and repair already-Scheduled events).
2. Filters shows already scheduled on Substack with a non-null stream key.
   - {{BRAND_ISOLATION}}
3. Applies the default 7-day scheduling horizon. Whether a show needs scheduling is decided by the event's badge in Restream Studio, not by D1.
4. If no eligible shows remain, exit quietly ("No shows ready for Restream scheduling"). This is the common case — not an error.
5. Otherwise automate Restream Studio (find the draft event by title, set date/time, pair the Substack channel, click Schedule) and write the result back via `upsert_restream_event`.
6. Already-Scheduled events whose show changed after scheduling (new stream key, renamed, or moved date/time) get their Substack channel re-paired and/or are rescheduled. See the skill's `references/repair-scheduled-events.md`.
7. If a show's Substack channel doesn't exist yet, the skill does NOT schedule it. It re-checks at the end of the run, then creates a one-shot retry task about 15 minutes out (up to 3 retries).

## Notes

- Only schedule Draft events. Never touch Live events. Scheduled events are changed only by the repair flow (re-pair the channel, or reschedule after a date/time change), and only before airtime.
- If no draft event matches a show's title, skip that show and note it in the report.
- Process shows one at a time, completing each fully before moving to the next.
