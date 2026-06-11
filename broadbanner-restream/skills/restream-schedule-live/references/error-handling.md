# Error Handling

Detailed recovery procedures for each failure mode in the Restream event scheduling workflow.

## Not logged in

**Symptom:** Login prompt or redirect to sign-in page instead of the Restream dashboard.

**Action:** Stop immediately. Tell the user to log in manually to Restream at `app.restream.io` in Chrome. Do not attempt to automate login — Restream uses Google OAuth which requires real user interaction.

## Event not found in list

**Symptom:** No draft event in the Restream home list contains the show's `defaultShowTitle`.

**Root causes:**
- The event hasn't been created yet in Restream Studio.
- The event title was manually renamed and no longer contains the default show title.
- The event list is paginated and the target event is on a later page.

**Recovery:**
1. Scroll down the event list to check for pagination or lazy-loading.
2. Use `read_page` to scan all visible event titles.
3. If still not found, alert the user. They may need to create the event manually via "+ New Stream" in Restream Studio.
4. Do NOT create events via this skill — it only schedules existing drafts.

## Event already Scheduled / Live / Finished (not Draft)

**Symptom:** The matching event row in the Restream Studio UI shows a "Scheduled", "Live"/"In progress", or "Finished" status badge instead of "Draft".

**Action:** Skip this event. This decision is made by Step 2's `read_page` of the event row — it is the sole authority. Do NOT pre-filter shows out of the eligible list using D1's `event_status` field (that field has been observed disagreeing with the UI because Restream's `GET /v2/user/events` API misreports Draft events as `upcoming`/`finished`, and the poller faithfully syncs that to D1).

Note the skip in the final report. Optionally best-effort PATCH the Data Worker to align D1 with the UI (`event_status: "scheduled"` or `"finished"`, along with `event_id` if it can be read off the row). Failure of that PATCH is not fatal — leave a log line and move on.

Never click into the Schedule modal for a non-Draft row. Rescheduling a Scheduled row would clobber the existing channel pairing or date; rescheduling a Live row would mutate an in-progress stream.

## Multiple events match the same default title

**Symptom:** Two or more draft events contain the same `defaultShowTitle` (e.g., two "Intelligent Masculinity" episodes from different weeks).

**Recovery:**
1. Compare each matching event's full title against the show's `showTitle` — prefer the closest match.
2. Check the "Last edited" date — prefer the most recent draft.
3. If still ambiguous, present both options to the user and ask them to choose.
4. Do NOT schedule the wrong event — it's better to ask than to guess.

## Three-dot menu doesn't appear

**Symptom:** Clicking the ⋮ icon on the event row doesn't open the dropdown menu.

**Recovery:**
1. Verify you're clicking the correct element — use `find` to locate the menu button.
2. Try clicking the row first to select/focus it, then click the ⋮ icon.
3. If `left_click` is blocked by extension interference, ask the user to click it.

## Schedule option missing from dropdown

**Symptom:** The three-dot dropdown opens but doesn't include "Schedule".

**Root causes:**
- The event may already be scheduled (status isn't Draft).
- The event may be in a state that doesn't support scheduling.

**Recovery:**
1. Check the event's current status via `read_page`.
2. If not Draft, skip this event and note why.
3. If the menu has different options than expected, take a screenshot and alert the user.

## Schedule modal doesn't load

**Symptom:** Clicking "Schedule" in the dropdown doesn't produce the "Schedule event" modal.

**Recovery:**
1. Wait 3 seconds — the modal may be loading.
2. Use `read_page` to check if the modal appeared outside the visible area.
3. Try clicking "Schedule" again.
4. If the modal still doesn't appear, the Restream UI may have changed. Alert the user and suggest scheduling manually.

## Date/time input rejected

**Symptom:** The date or time field doesn't accept the entered value, shows an error, or reverts.

**Root causes:**
- The input format doesn't match what Restream expects.
- The scheduled time is in the past.
- Restream may enforce a minimum scheduling lead time.

**Recovery:**
1. Try alternative date formats: `YYYY-MM-DD`, `MM/DD/YYYY`, `Apr 13, 2026`.
2. Try alternative time formats: `HH:MM` (24h), `HH:MM AM/PM` (12h).
3. Verify the show's `scheduledStartLocal` is in the future.
4. If the time has passed, alert the user — the show may need to be rescheduled in Wix.

## Channel not found in Add Channels modal

**Symptom:** No channel in the list matches the show's title.

**Root causes:**
- The Substack channel hasn't been created yet.
- The channel name format doesn't match expectations.
- The channel may be on a different page or tab ("Paired Channels" vs "Your Channels").

**Recovery:**
1. Check both "Your Channels" and "Paired Channels" tabs.
2. Scroll through the full channel list.
3. Try partial matching — look for any channel containing part of the show title.
4. If no match, alert the user. Suggest running `banner-blast restream-poller` to create the channel (it now reads show data from the Data Worker snapshot — the legacy `--wix-latest` flag is no longer needed), or creating it manually in Restream Studio.
5. Do NOT skip the channel pairing step — the event needs at least one active channel to stream to.

## Channel toggle doesn't respond

**Symptom:** Clicking the channel toggle doesn't change its state.

**Recovery:**
1. Verify the toggle element was correctly identified — use `read_page` to inspect.
2. Try clicking the channel row/card instead of the toggle switch directly.
3. Try clicking the "Edit" button next to the channel, which may reveal toggle controls.
4. If `left_click` is blocked by extension interference, ask the user to toggle it.
5. Verify the active count changed after the click.

## Schedule button disabled

**Symptom:** The "Schedule" button at the bottom of the Add Channels modal is grayed out or doesn't respond to clicks.

**Root causes:**
- No channels are toggled ON.
- Required fields (date, time) are missing or invalid.
- The modal is in a loading state.

**Recovery:**
1. Verify at least one channel is active (check the "N of M active" count).
2. Verify the date and time fields are populated.
3. Wait 2 seconds and try again — the button may be temporarily disabled during a state update.
4. If the button remains disabled, use `read_page` to check for error messages in the modal.

## State tracker write conflict

**Symptom:** A workspace-scoped `restream-event-state-<workspace>.json` file was modified by another process between read and write.

**Prevention:** Always re-read the file before writing updates. Merge the new entry into the current file contents rather than overwriting from a stale in-memory copy.

> **Do not** write to the legacy un-suffixed `restream-event-state.json` even if it exists in `Social-Distribution/` — it is frozen pre-workspace history and must not be touched by this skill.

**Recovery:**
1. Re-read the current file.
2. Apply only the new show entry.
3. Write the file back.

## Partial failure across multiple shows

**Symptom:** Some shows scheduled successfully, others failed.

**Action:** Do NOT roll back successful shows. Report the mixed results clearly:
- List successful shows with confirmation.
- List failed shows with failure reasons.
- Failed shows will not have entries in their workspace-scoped `restream-event-state-<workspace>.json`, so they can be retried on the next run.
