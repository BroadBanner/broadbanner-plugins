---
id: schedule-substack-live-{{PROJECT_BASENAME}}
description: Run the substack-schedule-live skill daily for {{BRAND_DISPLAY}} — schedules ready shows on Substack.
cronExpression: 10 3 * * *
enabled: true
---
You are running on a daily ~3:10am schedule. Invoke the `substack-schedule-live` skill from the `broadbanner-social-distribution` plugin. This run is pre-approved to run autonomously — do NOT pause for per-show confirmation.

## Workspace pin

Before invoking the skill, verify `{{PROJECT_ROOT}}` is the active Cowork project root. If it is not, call `request_cowork_directory` with `{{PROJECT_ROOT}}` and wait for confirmation. The skill resolves `<PROJECT_ROOT>/.creds/gateway.token` and `{{CREDS_DIR}}/.env.json` against the active project — without this pin it inherits whatever project is focused and uses the wrong cap token.

## What to do

Invoke the skill; it handles the snapshot fetch, filtering, and Substack automation internally.

1. Fetches the current show snapshot from the BroadBanner Gateway/Data Worker (credentials in `{{CREDS_DIR}}/.env.json`).
2. Filters shows that are titled, host-resolved, and waiting to be scheduled on Substack.
   - **Brand isolation:** ALSO require the show's `podId` starts with `{{POD_PREFIX}}` ({{BRAND_DISPLAY}} pods: {{POD_IDS}}). Never process shows from other brands.
3. Applies the default 7-day scheduling horizon.
4. If no eligible shows remain, exit quietly ("No shows ready to schedule"). This is the common case — not an error.
5. Otherwise schedule each on Substack and PATCH the Data Worker with the scheduled state plus captured stream credentials.

## Prerequisites

- The "{{CHROME_PROFILE}}" Chrome profile must be logged in to the {{BRAND_DISPLAY}} Substack publication.
- `BROADBANNER_ENC_PASSPHRASE` present in `{{CREDS_DIR}}/.env.json`.

## Notes

- Solo shows: leave the co-host toggle OFF and click "Schedule stream"; do NOT use the co-host "Continue → Generate stream key" path. (Brands with co-hosts should edit this note in their copy.)
- Close any browser tabs used for scheduling after each show.
