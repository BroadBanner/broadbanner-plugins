---
id: schedule-restream-live-{{PROJECT_BASENAME}}
description: Run the restream-schedule-live skill daily for {{BRAND_DISPLAY}} — pairs Substack channels and schedules draft Restream events.
cronExpression: 0 4 * * *
enabled: true
---
You are running on a daily ~4:00am schedule, AFTER the substack-live task has already captured stream keys and scheduled shows on Substack. Invoke the `restream-schedule-live` skill from the `broadbanner-restream` plugin.

## Workspace pin

Before invoking the skill, verify `{{PROJECT_ROOT}}` is the active Cowork project root. If it is not, call `request_cowork_directory` with `{{PROJECT_ROOT}}` and wait for confirmation. The skill resolves `<PROJECT_ROOT>/.creds/gateway.token` and the per-workspace Restream credential context against the active project.

## What to do

Invoke the skill; it handles the snapshot fetch, restream-event state check, and Restream Studio automation internally.

1. Fetches the current show snapshot from the BroadBanner Gateway/Data Worker (credentials in `{{CREDS_DIR}}/.env.json`).
2. Filters shows already scheduled on Substack with a non-null stream key.
   - **Brand isolation:** ALSO require the show's `podId` starts with `{{POD_PREFIX}}` ({{BRAND_DISPLAY}} pods: {{POD_IDS}}). Never process shows from other brands.
3. Applies the default 7-day scheduling horizon and excludes shows already scheduled in Restream (`GET /restream-events`).
4. If no eligible shows remain, exit quietly ("No shows ready for Restream scheduling"). This is the common case — not an error.
5. Otherwise automate Restream Studio (find the draft event by title, set date/time, pair the Substack channel, click Schedule) and PATCH the result back to the Data Worker.

## Prerequisites

- Logged in to Restream Studio in the "{{CHROME_PROFILE}}" Chrome profile.
- `BROADBANNER_ENC_PASSPHRASE` present in `{{CREDS_DIR}}/.env.json`.
- The matching Substack channel must already exist in Restream (created by channel sync).

## Notes

- Only schedule Draft events; never touch events already in Scheduled or Live status.
- If no draft event matches a show's title, skip that show and note it in the report.
- Process shows one at a time, completing each fully before moving to the next.
