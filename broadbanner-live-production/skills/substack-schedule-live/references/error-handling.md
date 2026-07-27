# Error Handling

Detailed recovery procedures for each failure mode in the Substack live stream scheduling workflow.

## Not logged in

**Symptom:** Login prompt visible instead of the publisher dashboard after navigation.

**Action:** Stop immediately. Tell the user to log in manually to the correct Substack publication in Chrome. Do not attempt to automate login.

## Wrong publication logged in

**Symptom:** The "Go live with stream key" modal shows a different publication name or host than expected for the show being scheduled.

**Action:** Alert the user. They need to switch to the correct Substack account. This can happen when scheduling shows across `sickofthis.substack.com` and `bannerandbackbone.substack.com` — each is a separate publication that may require different login sessions.

## Modal doesn't appear

**Symptom:** Navigating to the `substackLiveUrl` (which includes `?action=setup-live-stream`) does not produce the "Go live with stream key" dialog.

**Recovery:**
1. Wait 3 seconds — the page may still be loading.
2. Take a screenshot to check the page state.
3. Use `find` to locate "Go live", "Live video", or "Stream" elements on the page.
4. If found, click to trigger the modal manually.
5. If not found, the page layout may have changed. Use `read_page` to inspect the dashboard for live streaming options.

## Title entry fails

**Symptom:** The title input field is empty after using the `type` action.

**Recovery:**
1. Use the native input value setter fallback (see js-verification.md).
2. The React-controlled input requires dispatching `input` and `change` events after setting the value programmatically.
3. If still empty after the fallback, try clicking the input field at different coordinates and retyping.

## Schedule toggle doesn't respond

**Symptom:** Clicking the "Schedule for a future date" toggle doesn't enable it, or the date/time input doesn't appear.

**Recovery:**
1. Verify the toggle element was correctly identified — take a screenshot.
2. Try clicking the toggle's label text "Schedule for a future date" instead of the switch element.
3. Use `find` to locate the toggle by text and click it.
4. If the toggle is already ON (e.g., from a previous attempt), the date input should already be visible.

## Date/time input rejected

**Symptom:** Substack displays an error after entering the scheduled date, or the date field reverts.

**Root causes:**
- The scheduled time is in the past.
- The scheduled time is too close to now (Substack may require a minimum lead time).
- The date format doesn't match what Substack expects.

**Recovery:**
1. Verify the formatted date string matches `MM/DD/YYYY, HH:MM AM/PM` exactly.
2. Check that the show's `scheduledStartLocal` is in the future.
3. If the time has passed, alert the user — the show may need to be rescheduled in Wix first.

## Co-host not found in search

**Symptom:** Searching for a co-host by username or name returns no results.

**Root causes:**
- The username extracted from URLs may not match their Substack search handle.
- The person may not have a Substack account or may not have installed the Substack app.
- Search may be slow — results haven't loaded yet.

**Recovery:**
1. Wait 3 seconds and check again.
2. Try alternative search terms:
   - If searched by username, try the full name.
   - If searched by name, try just the first name or last name.
   - Try the subdomain from their `platformUrl`.
3. If still not found after 2 attempts, **skip this co-host** and note the failure.
4. Do NOT block the entire scheduling process for one missing co-host.
5. Include the skipped co-host in the final report so the user can invite them manually.

## Co-host checkbox doesn't respond

**Symptom:** Clicking the checkbox next to a search result doesn't select the co-host.

**Recovery:**
1. Take a screenshot to verify the click target.
2. Try clicking the row/card containing the co-host name instead of the checkbox directly.
3. Use `find` to locate the checkbox element and click it via coordinates.
4. Verify selection by checking if the "Invite N co-host" button count incremented.

## Stream credentials not displayed

**Symptom:** After generating the stream key, the expected URL and key fields are not visible.

**Recovery:**
1. Take a screenshot — the credentials modal may have a different layout than expected.
2. Use `read_page` to capture all text content in the modal.
3. Look for strings matching RTMP URL patterns (`rtmp://` or `rtmps://`) and alphanumeric key patterns.
4. Check for "Copy" buttons that may indicate copyable credential fields.
5. If credentials are truly not present, the user can retrieve them later from the Substack dashboard. Note this in the report and continue processing remaining shows.

## Gateway PATCH conflict / 4xx

**Symptom:** A `PATCH /v1/shows/<id>` or `PATCH /v1/shows/<id>/{hosts,guests}/<contributor_id>` call to `gateway.broadbanner.com` returns a 4xx response (`invalid_field`, `not_found`, `unauthorized`, `forbidden`).

**Prevention:** Send only the snake_case managed fields documented in `gateway-auth.md` (`schedule_state`, `substack_livestream_url`, `restream_stream_key`, `cohost_invite_url`). Use the verbose 0016 vocabulary for `schedule_state` (`substack_scheduling`, `substack_scheduled`, etc.) — the legacy `pending`/`ready`/`in_progress`/`scheduled` set fails the CHECK constraint. The cap-token is reused as-is across retries — there's nothing to re-sign.

**Recovery:**
1. Inspect the response body — the Gateway returns a JSON error envelope (`invalid_field` includes the offending field name; the Data Worker's response is forwarded unchanged).
2. Do NOT retry 4xx — the request shape (or the token) is wrong; retrying won't fix it.
3. For `401 unauthorized`, the workspace cap-token is missing/malformed/expired. Stop and tell the user to re-run `banner-blast init <project-id> --update` (or `banner-admin tokens issue --for <them> --caps posts:write,shows:read,shows:write`).
4. For `403 forbidden — missing capability: shows:write`, the workspace token isn't admin-tier. The contributor needs `is_admin=1` in D1. Stop and report.
5. For `not_found` on a junction PATCH, the cohort row hasn't been mirrored yet by the reconcile cron — log a warning, skip that one cohost, and continue. The next reconcile cycle (every 30 min) will create the row.
6. For 5xx or network errors, retry with exponential backoff (500 ms → 1 s → 2 s, max 3 retries) per `gateway-auth.md`. No re-signing needed.
7. Never write to a local `wix-latest.json` to compensate — D1 is the system of record; the Gateway snapshot endpoint will reflect the next successful PATCH within 5 minutes (cache TTL).
8. **Do NOT fall back to direct `data.broadbanner.com` HMAC.** That bypass path has been removed from this skill on purpose — a 4xx/5xx at the Gateway is the failure to report, not a signal to route around it.

## Partial failure across multiple shows

**Symptom:** Some shows scheduled successfully, others failed.

**Action:** Do NOT roll back successful shows. Report the mixed results clearly:
- List successful shows with their stream credentials.
- List failed shows with failure reasons and recovery suggestions.
- Shows that failed mid-run will still have `schedule_state: "in_progress"` in D1 (the underscore form is the only legal value at the column-CHECK level). The user can reset these to `"ready"` via `banner-admin shows patch <show_id> --schedule_state ready` (or a direct PATCH /shows/<id>) and re-run the skill, or schedule them manually.
