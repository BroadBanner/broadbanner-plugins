---
id: schedule-substack-live-{{PROJECT_BASENAME}}
description: Run the substack-schedule-live skill daily for {{BRAND_LABEL}} — schedules ready shows on Substack.
cronExpression: 10 3 * * *
enabled: true
---
<!-- Pre-Production Assistant (Production+ add-on, pre_production_assistant / cap scheduling:auto): the unattended auto-scheduling of Substack lives. -->
You are running on a daily ~3:10am schedule as a **cloud** Cowork scheduled task. Invoke the `substack-schedule-live` skill from the `broadbanner-live-production` plugin. This run is pre-approved to run autonomously — do NOT pause for per-show confirmation.

## Runs in the cloud

Substack has no scheduling API, so this drives a browser — the **cloud environment's own browser**, not your computer's. (Cowork is retiring tasks that run on your computer; BroadBanner tasks are cloud-only.) That browser must be logged in to {{PUBLICATION_TARGET}} — sign in once in the cloud environment; its login is separate from your local Chrome. If there's no browser or it hits a login wall, the skill stops and reports; nothing is scheduled.

The skill converts show times against the **browser's own timezone** (it reads it from the page), so a cloud browser running in UTC still schedules each show at the right moment. The cron itself is evaluated in the scheduler's timezone — for a daily sweep with a 7-day horizon the exact hour doesn't matter.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on a session authorized to schedule (brand-admin / super-admin today; host-of-series once creator-scoped scheduling ships). The skill is **connector-only** — no `broadbanner.config.json`, no `.creds/gateway.token`, no `BROADBANNER_ENC_PASSPHRASE`, no mount.
- The cloud environment's browser logged in to {{PUBLICATION_TARGET}}. There is no profile routing — the skill uses the browser it has and verifies the account.

## What to do

Invoke the skill; it fetches show data via the connector's admin tools and handles the Substack automation internally.

1. Calls `list_schedulable_shows({ states: ["title_customized"] })` via the connector (served fresh each call).
2. Filters to shows ready to schedule.
   - {{BRAND_ISOLATION}}
3. Applies the default 7-day scheduling horizon.
4. If no eligible shows remain, exit quietly ("No shows ready to schedule"). This is the common case — not an error.
5. Otherwise schedule each on Substack and write the scheduled state + captured stream credentials back to D1 via the connector tools (`set_show_schedule`, `set_show_cohost_invite`).

## Notes

- Solo shows: leave the co-host toggle OFF and click "Schedule stream"; do NOT use the co-host "Continue → Generate stream key" path. (Brands with co-hosts should edit this note in their copy.)
- Close any browser tabs used for scheduling after each show.
