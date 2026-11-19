# Substack schedule-live — Tool reliability and technical notes

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Tool reliability guide

Browser extensions can intermittently block certain Chrome MCP tools. The following tools are **always reliable** and should be preferred:

| Tool               | Reliability    | Use for                                                      |
| ------------------ | -------------- | ------------------------------------------------------------ |
| `read_page`        | Always works   | Verifying state, reading element refs, capturing credentials |
| `find`             | Always works   | Locating elements by description                             |
| `form_input`       | Always works   | Setting text inputs, datetime-local inputs, select dropdowns |
| `navigate`         | Always works   | Page navigation                                              |
| `tabs_context_mcp` | Always works   | Getting tab IDs                                              |
| `scroll_to`        | Always works   | Scrolling elements into view                                 |
| `screenshot`       | Can be blocked | Visual verification (use `read_page` as fallback)            |
| `left_click`       | Can be blocked | Clicking buttons (ask user to click as fallback)             |
| `javascript_tool`  | Can be blocked | DOM manipulation (use `form_input` instead)                  |

**Strategy:** Use `find` + `form_input` for all data entry. Use `read_page` for verification instead of `screenshot`. Only use `screenshot`/`left_click` when the reliable tools cannot accomplish the task. If blocked, ask the user to perform the click.

## Key technical notes

- **Do NOT resize the window to 1200×900.** The user has set a narrower window (~650×900) that keeps the entire modal visible without internal scrolling. Do not override their window size.
- **The `substackLiveUrl` includes `?action=setup-live-stream`** which should auto-open the scheduling modal on page load.
- **Date/time input is `type="datetime-local"`** — set it via `form_input` with ISO format `YYYY-MM-DDTHH:MM`. Do NOT use the calendar picker or formatted date strings. The value MUST be in the **browser's timezone** (`BROWSER_TZ`, resolved per the "Timezone handling" recipe) — compute it from `scheduledStart` by passing the zone explicitly to `Intl.DateTimeFormat`, never via the shell's ambient `TZ`/`getHours()` (the sandbox shell is often UTC). Never feed `scheduledStartLocal` directly; it's in the show's stored TZ.
- **Set the date/time LAST** in the modal to avoid extension interference after the datetime-local input is modified.
- **The primary host comes from `show.primaryHost`** — resolved from Import2's `primaryHostName` reference via ContributorProfiles → Affiliates name matching. Select them in the "The person going live is..." `<select>` dropdown. They are already excluded from the `hosts` array by the poller.
- **The `substackUsername` field** is pre-extracted and normalized by the Data Worker reconcile cron (no `@` prefix, no whitespace) when it mirrors Wix into D1, and is served on the read side. Use it directly for co-host search.
- **Co-hosts must have Substack accounts with the app installed.** If a co-host doesn't appear in search results, they may not have installed the Substack app — note this in the failure report.
- **Process shows grouped by publication** to minimize account-switching. Sort ready shows by `substackLiveUrl` before processing.
- **The "Invite co-hosts" toggle changes the main button** from "Generate stream key" / "Schedule stream" to "Continue".
- **Substack renders TWO dialog elements.** The first contains the main modal, the second contains the co-host / credentials modal. Always scope `read_page` to the correct dialog ref.
- **Always create a new tab** for each show. Do not reuse tabs — modal state and extension interference can carry over.
- **Single browser profile.** This is production-support scheduling run from whatever Chrome profile is connected; there is no per-show profile routing. The operator can schedule for themselves and for other primary hosts across publications in that one profile.
