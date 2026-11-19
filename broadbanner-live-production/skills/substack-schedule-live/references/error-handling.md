# Substack schedule-live — Error handling

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Error handling

- **Pre-check page fails to load:** If the `/publish/live-videos/scheduled` page doesn't load (network error, login redirect), log a warning and proceed with scheduling anyway — the pre-check is a safety net, not a hard gate.
- **Pre-check finds ambiguous match:** If the page shows a live with a similar but not exact title, report both titles to the user and ask whether to skip or proceed.
- **Not logged in:** Stop and tell the user to log in to the correct Substack publication.
- **Wrong publication:** If the modal shows a different publication than expected, alert the user. They may need to switch accounts.
- **Modal doesn't appear:** The `?action=setup-live-stream` URL parameter should trigger it automatically. If not, look for a "Go live" or "Live video" option in the Substack publisher dashboard.
- **Extension blocks tools:** `screenshot`, `left_click`, and `javascript_tool` can be blocked by Chrome extensions. Use `read_page` for verification, `form_input` for data entry, and ask the user to click buttons when `left_click` fails.
- **Co-host not found:** Skip the person, note the failure, and continue with remaining co-hosts. Do not block the entire scheduling process for one missing co-host.
- **Co-host checkbox can't be clicked:** The checkbox is a `<button>`, not `<input>`. If `left_click` is blocked, ask the user to check it manually.
- **Date/time input rejected:** Substack may enforce minimum scheduling windows (e.g., must be at least 1 hour in the future). If the date is rejected, alert the user with the scheduled time and ask for guidance.
- **Stream credentials not displayed:** Use `read_page` to find the credentials. They are in textbox elements in the second dialog. If truly not present, report the failure — the user can retrieve credentials manually from the Substack dashboard.
- **Invites API returns non-200 or fails:** Log a warning, **skip ALL invite junction writes for this show** (do NOT overwrite stored values with null on API failure), and continue. The user can retrieve invite links manually from the Substack dashboard at `{substackBaseUrl}/publish/home?action=setup-live-stream&stream_id={streamId}` — the "Co-host status" section in that modal displays each cohost's invite status and a "Copy invite link" button.
- **Cohost already accepted (`status === "accepted"`):** Call `set_show_cohost_invite` with `cohostInviteUrl: null` for that junction — they're confirmed and no invite link is needed.
- **Cohost in show but not found in invites API response:** Skip the write for this cohost entirely. Not calling the tool preserves any prior value in D1.
- **`substackUsername` is null on a cohost:** Fall back to case-insensitive name matching against `invitedUser.name` from the API. If still no match, skip the write for this cohost.
- **Multiple shows on same publication:** Process sequentially. Create a new tab for each show — the URL triggers a fresh modal each time.
- **A `set_show_schedule` / `set_show_cohost_invite` call errors transiently (`5xx`/network):** Retry the tool call (up to 3×, brief backoff — 500 ms → 1 s → 2 s). After retries exhaust, report the failure for this show and continue to the next show — don't abort the whole run.
- **A tool returns an authorization error:** The connector session isn't authorized to schedule this show — you must **host the series** (a creator with the Creator Workspace entitlement) or hold a brand-admin/super-admin role. A `forbidden_not_host` on a cohost-invite write means you don't host that show. Stop the run and tell the user; there is no fallback path.
- **A tool returns a request-shape error (`invalid_field`, or `not_found` on the show):** Fail loud for this show with the message. Do NOT retry — a 4xx-class error indicates a bad request or a missing show in D1, neither of which retry can fix. Continue to the next show.
- **`set_show_cohost_invite` reports the junction row missing (`not_found`):** The junction doesn't exist in D1 yet — likely a contributor just added to Wix's `hosts[]`/`guests[]` that the reconcile cron hasn't picked up. Log a warning, skip this cohost's invite write, and continue. The next reconcile cycle creates the junction; a re-run of this skill will then succeed.
- **The connector or its data plane is unreachable:** Stop the run and tell the user. There is no direct-API bypass — this skill talks only to the connector tools.
