---
id: schedule-substack-live-{{PROJECT_BASENAME}}
description: Run the substack-schedule-live skill daily for {{BRAND_DISPLAY}} — schedules ready shows on Substack.
cronExpression: 10 3 * * *
enabled: true
---
You are running on a daily ~3:10am schedule on the operator's **local machine**. Invoke the `substack-schedule-live` skill from the `broadbanner-live-production` plugin. This run is pre-approved to run autonomously — do NOT pause for per-show confirmation.

## ⚠️ Local machine only — cannot run in the cloud

This task drives a **local Chrome browser** through the Claude-in-Chrome connection (there is no Substack scheduling API). It **cannot** run on a cloud/headless agent — schedule it on a machine where the single BroadBanner Chrome profile is open and logged in to the {{BRAND_DISPLAY}} Substack publication at fire time. If no browser is connected, the skill stops and reports; nothing is scheduled.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on a session authorized to schedule (brand-admin / super-admin today; host-of-series once creator-scoped scheduling ships). The skill is **connector-only** — no `broadbanner.config.json`, no `.creds/gateway.token`, no `BROADBANNER_ENC_PASSPHRASE`, no mount.
- The **single connected** BroadBanner Chrome profile logged in to the {{BRAND_DISPLAY}} Substack publication. There is no profile routing — the skill uses whatever browser is connected and verifies the account.

## What to do

Invoke the skill; it fetches show data via the connector's admin tools and handles the Substack automation internally.

1. Calls `list_schedulable_shows({ states: ["title_customized"] })` via the connector (served fresh each call).
2. Filters to shows ready to schedule.
   - **Brand isolation:** ALSO require the show's `podId` starts with `{{POD_PREFIX}}` ({{BRAND_DISPLAY}} series: {{POD_IDS}}). Never process shows from other brands.
3. Applies the default 7-day scheduling horizon.
4. If no eligible shows remain, exit quietly ("No shows ready to schedule"). This is the common case — not an error.
5. Otherwise schedule each on Substack and write the scheduled state + captured stream credentials back to D1 via the connector tools (`set_show_schedule`, `set_show_cohost_invite`).

## Notes

- Solo shows: leave the co-host toggle OFF and click "Schedule stream"; do NOT use the co-host "Continue → Generate stream key" path. (Brands with co-hosts should edit this note in their copy.)
- Close any browser tabs used for scheduling after each show.
