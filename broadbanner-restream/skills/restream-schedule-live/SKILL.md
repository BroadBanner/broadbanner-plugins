---
name: restream-schedule-live
description: "Schedule Restream Studio events from BroadBanner show data. Use when the user says 'schedule the restream events', 'schedule restream', or 'set up restream' for upcoming podcast episodes. Reads shows and writes scheduled-event state via the BroadBanner MCP connector's admin tools, and automates the Restream scheduling UI via browser to pair the correct Substack channel. Connector-only (OAuth); requires a brand-admin or super-admin role."
---

# Restream Schedule Live

Schedule upcoming podcast live streams as Restream events using show data served by the **BroadBanner MCP connector** (server `broadbanner`). This skill automates the Restream Studio event scheduling flow — finding the draft event by show title, updating the title and date/time, pairing the correct Substack streaming channel, and clicking Schedule. After scheduling, it writes the event state back to D1 via the `upsert_restream_event` connector tool.

This skill authenticates **only through the MCP connector**, which the creator has authorized via OAuth — there is no token file, no config file, no mount, and no request signing. The connector's admin tools fail closed: a session without a brand-admin or super-admin role gets an authorization error. If a tool call fails that way, stop and report — there is no direct-API fallback to route around it.

## Admin scheduling tools (MCP connector `broadbanner`)

All data access goes through these tools — there is no `curl`, no `API_BASE`, no auth header, no local file:

| Tool                     | Args                                                                                      | Replaces                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_schedulable_shows` | none                                                                                      | `GET /v1/shows` snapshot read. Returns `{ generatedAt, shows: [...], _fetch: { cfCacheStatus, age, cfRay } }` verbatim, served fresh each call. |
| `get_restream_workspaces`| none                                                                                      | `GET /v1/restream-workspaces`. Returns `{ accounts: [{ id, workspaces: [{ workspaceName, isDefault, podIds }] }] }` verbatim.        |
| `list_restream_events`   | `{ workspace?, event_status? }`                                                           | `GET /v1/restream-events`. Returns `{ restream_events: [...] }`. **Courtesy/informational only** — never a scheduling gate.          |
| `upsert_restream_event`  | `{ showId, publication, event_status, event_id, scheduled_at, workspace? }`               | `PATCH /v1/restream-events/:show_id`. The tool sets `X-Actor: skill:restream-schedule-live`, `X-Publication`, and the `workspace` query param FOR you. |

**Passing `publication` and `workspace` to `upsert_restream_event`:**

- `publication` is the `X-Publication` id (e.g. `sotsp`, `babm`, `lr`). **Required.** Derive it deterministically as the **prefix of the show's `seriesId` before the first hyphen** — `sotsp-im` → `sotsp`, `babm-afbc` → `babm`, `lr-lr` → `lr`. This holds for every series in the ecosystem (the seriesId is always `<publicationId>-<slug>`). Do NOT use the `brand` field for this.
- `workspace` is the Restream workspace name. **OMIT it entirely when the show's workspace is the account default** (the `isDefault` case) — do NOT pass an empty string. Pass a workspace name only for a non-default workspace.

`changed: false` is success — the row already matched. On a transient/`5xx` tool error, retry the call (up to 3×, brief backoff). On an authorization error, stop — the connector session isn't admin. See `references/gateway-auth.md` for the full tool reference.

## Prerequisites

- The user must be logged in to Restream Studio at `app.restream.io` in Chrome before running.
- The BroadBanner MCP connector (server `broadbanner`) must be connected and the creator's session must carry a **brand-admin or super-admin** role — the admin scheduling tools fail closed otherwise (you'll get an authorization error). No token file, config, or workspace mount is required.
- D1 must contain shows whose `hasLiveScheduled` is either `"substack_scheduled"` (Substack creds present, Restream channel not yet paired) OR `"restream_paired"` (channel_id present in `restream_events`, but no event_status='scheduled' write yet), AND with a non-null `restreamKey`. Both states are reachable from the substack-schedule-live skill plus Restream-Worker's channel-sync; this skill takes them the rest of the way to `restream_scheduled` by creating the Restream event and writing `restream_events.event_status='scheduled'`. The derive pass then promotes the show to `restream_scheduled` on the next reconcile tick. Shows already at `restream_scheduled` are excluded — they're done.
- The matching Substack channel must already exist in Restream — provisioned by the **Restream-Worker** channel-sync pass (`broadbanner-restream` Worker, every _/30 cron tick under the `'poll'` kind, plus on-demand via the HMAC-authed `POST /sync-channels` route). Channel names follow the format `"{showTitle} - {showDate}"` and the Worker writes `channel_id` back to D1's `restream_events` row, so this skill can rely on it being present. The legacy local `banner-blast restream-poller --wix-latest` and `banner-admin schedule-live` channel-sync paths are retired — see `Restream-Worker/README.md` for the current flow. If a channel is missing for a show whose Substack live is already scheduled, the Worker will create it on the next _/30 tick; trigger the sync immediately by hitting `/sync-channels` if you need it before then.

## Tool reliability guide

Browser extensions can intermittently block certain Chrome MCP tools. The following tools are **always reliable** and should be preferred:

| Tool               | Reliability    | Use for                                                              |
| ------------------ | -------------- | -------------------------------------------------------------------- |
| `read_page`        | Always works   | Verifying state, reading element refs, checking event/channel status |
| `find`             | Always works   | Locating elements by description                                     |
| `form_input`       | Always works   | Setting text inputs, date inputs, time inputs                        |
| `navigate`         | Always works   | Page navigation                                                      |
| `tabs_context_mcp` | Always works   | Getting tab IDs                                                      |
| `tabs_create_mcp`  | Always works   | Opening new tabs                                                     |
| `tabs_close_mcp`   | Always works   | Closing tabs                                                         |
| `screenshot`       | Can be blocked | Visual verification (use `read_page` as fallback)                    |
| `left_click`       | Can be blocked | Clicking buttons (ask user to click as fallback)                     |
| `javascript_tool`  | Can be blocked | DOM manipulation (use `form_input` instead)                          |

**Strategy:** Use `find` + `form_input` for all data entry. Use `read_page` for verification instead of `screenshot`. Only use `screenshot`/`left_click` when the reliable tools cannot accomplish the task. If blocked, ask the user to perform the click.

## Timezone handling (CRITICAL — read before Step 4)

The snapshot provides three scheduling-related fields per show:

| Field                    | Meaning                                                                            | Example                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| `scheduledStart`         | UTC ISO timestamp. Source of truth.                                                | `2026-04-14T17:00:00.000Z`               |
| `scheduledStartLocal`    | Wall-clock time in the **show's** `localTimeZone` (NOT the user's).                | `2026-04-14T13:00:00` (America/New_York) |
| `showDate` / `showStart` | Always rendered in `America/New_York` (Eastern) for legacy snapshot compatibility. | `2026-04-14` / `13:00:00.000`            |
| `localTimeZone`          | The show's stored timezone (often `America/New_York`).                             | `America/New_York`                       |

Restream Studio's Schedule modal Date/Time pickers operate on **the browser's timezone** (the label next to the Time field reflects the browser's machine, not the show). After the D1 migration, shows are commonly stored as `America/New_York` while the operator's machine is `America/Chicago` — using `scheduledStartLocal`, `showDate`, or `showStart` directly schedules the event at the wrong wall-clock time.

> **The conversion target is the BROWSER's timezone — not the bash environment's.** In a scheduled/Cowork run, this skill's shell executes in a sandbox whose `TZ` is often **UTC**, while Restream Studio runs in Chrome on the operator's machine. So `new Date(utc).getHours()` in bash (which reads the *shell's* ambient zone) is wrong by the full UTC offset (5–6h), not just the 1-hour ET↔CT case. **Never rely on the shell's ambient timezone.** Resolve the browser's IANA zone explicitly (`BROWSER_TZ`) and convert against it.

**Resolve `BROWSER_TZ`** (resolution order):

1. **Modal TZ label (authoritative here).** Once the Schedule modal is open (Step 4), the label beside the Time field IS the browser's zone (e.g. `America/Chicago`). `read_page` it and use it as `BROWSER_TZ`.
2. **Browser eval.** If the label isn't legible: `javascript_tool` → `Intl.DateTimeFormat().resolvedOptions().timeZone`.
3. **Ask.** If both are blocked: ask the user for their IANA zone.

Do **not** fall back to the shell's own timezone. (For a Step 0 preview before the modal is open, use the browser eval or ask provisionally and re-confirm against the modal label at Step 4.)

**Then convert `scheduledStart` (UTC) → `BROWSER_TZ` wall-clock**, passing the zone explicitly so the result is independent of the shell's ambient `TZ`:

```bash
SCHEDULED_START_UTC="2026-04-14T17:00:00.000Z"
BROWSER_TZ="America/Chicago"   # resolved above

DATETIME_LOCAL=$(SS="$SCHEDULED_START_UTC" BTZ="$BROWSER_TZ" node -e '
  const d = new Date(process.env.SS), tz = process.env.BTZ;
  if (!tz || isNaN(d.getTime())) { console.error("bad SCHEDULED_START_UTC/BROWSER_TZ"); process.exit(2); }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;
  console.log(`${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`);
')
[ -z "$DATETIME_LOCAL" ] && { echo "TZ conversion failed — do not fill the modal" >&2; exit 1; }
LOCAL_DATE="${DATETIME_LOCAL%T*}"    # "2026-04-14"  → Date picker
LOCAL_TIME_24="${DATETIME_LOCAL#*T}" # "12:00"       → Time picker (24h)

# 12-hour AM/PM string (e.g. "12:00 PM"), also in BROWSER_TZ:
LOCAL_TIME_12H=$(SS="$SCHEDULED_START_UTC" BTZ="$BROWSER_TZ" node -e '
  console.log(new Date(process.env.SS).toLocaleTimeString("en-US",
    { timeZone: process.env.BTZ, hour: "numeric", minute: "2-digit", hour12: true }));
')

# BROWSER_TZ IANA + abbreviation — used to verify the modal's TZ label
MACHINE_TZ_IANA="$BROWSER_TZ"
MACHINE_TZ_ABBR=$(BTZ="$BROWSER_TZ" node -e "
  console.log(new Intl.DateTimeFormat('en-US', { timeZone: process.env.BTZ, timeZoneName: 'short' })
    .formatToParts(new Date()).find(p => p.type === 'timeZoneName').value);
")
```

Use `LOCAL_DATE` for the Date picker (Step 4b) and `LOCAL_TIME_24` / `LOCAL_TIME_12H` for the Time picker (Step 4c). **Never feed `showDate`, `showStart`, or `scheduledStartLocal` directly** (non-machine timezones), and **never an ambient-`getHours()` value** (the sandbox shell is often UTC).

When the show list is presented to the user (Step 0) and in the final report (Step 9), display the machine-local time so the user can verify what will actually be entered. Surface the show-stored timezone equivalent only when it differs from the machine TZ.

## State tracker

Scheduling state lives in D1's `restream_events` table, reached through the connector's admin tools. The local `Social-Distribution/restream-event-state-*.json` files are **frozen** as of the Phase 3 cutover (2026-05-13) — do not read or write them. All current state flows through the tools.

**Row identity is `(show_id, restream_workspace)`** — a single show can have a row per workspace because each Restream workspace carries its own OAuth credential set (SOTSP's `sick-of-this-show` and `time-for-life` are the canonical example). When the user's Restream account has no workspace selector at all (e.g. LR / LevRemembers), the workspace is `null` and there's exactly one row per show.

The account → workspace → pod-id catalog comes from `get_restream_workspaces` (no arguments). The response is account-oriented — `accounts[i]` is a Restream account (1:1 with networks), each with its `workspaces[]` and per-workspace `podIds[]`. Look up a pod by walking `accounts[].workspaces[].podIds[]` and using the matching workspace's `workspaceName`. When `isDefault` is true, **omit the `workspace` arg** on `upsert_restream_event`; Restream's API treats single-workspace accounts as not requiring it. For multi-workspace accounts, each workspace must be queried independently (one `list_restream_events({ workspace })` per workspace).

> The catalog lives in D1's `restream_accounts` + `restream_workspaces` + `pods.restream_workspace_id` (D1 migs 0027 + 0028) — adding a new account, workspace, or pod assignment is a SQL change, no skill edit + redeploy. The legacy `references/restream-workspaces.json` is retained in-repo only as historical reference.

**Read path** — `list_restream_events({ workspace })` returns the workspace's rows; an optional `event_status` narrows by status. This is a read of the D1 cache, **not** an authoritative source for "is this event already scheduled" — Step 0 explicitly does not use this tool as a pre-flight filter (see the warning in Step 0). Treat any read here as informational. The response shape:

```json
{
  "restream_events": [
    {
      "show_id": "show-abc-123",
      "brand_id": "sotsp",
      "pod_id": "sotsp-cio",
      "restream_workspace": "sick-of-this-show",
      "show_title": "Chronically Illing Out | E27 - Writing, Creating, and Caring For Yourself",
      "show_date": "2026-04-13",
      "channel_id": 12345,
      "channel_name": "Chronically Illing Out | E27 ... - 2026-04-13",
      "channel_created_at": "2026-04-10T14:30:00.000Z",
      "event_id": "abc-def-123",
      "event_status": "scheduled",
      "scheduled_at": "2026-04-11T20:00:00.000Z",
      "last_synced_at": "2026-05-13T13:58:00.000Z"
    }
  ]
}
```

**Write path** — `upsert_restream_event(...)` upserts a row. If no row exists for the (show_id, workspace) pair, the server INSERTs; otherwise UPDATE only the fields you pass. Workspace is identity, not a payload field — the tool applies it as the `workspace` query param (or omits it for the default case). After successfully scheduling on Restream, call the tool with `event_status: "scheduled"`, `event_id`, and `scheduled_at`.

**Allowed write fields for this skill** (the tool sends `X-Actor: skill:restream-schedule-live`, which the Data Worker constrains server-side to these three):

| Field          | Type             | Notes                                                 |
| -------------- | ---------------- | ----------------------------------------------------- |
| `event_id`     | `string \| null` | Restream event UUID captured from the scheduled event |
| `event_status` | enum             | `"scheduled"` after a successful schedule             |
| `scheduled_at` | `string \| null` | ISO 8601 timestamp the event was scheduled            |

The poller (`cli:restream-poller`) owns channel metadata (`show_title`, `show_date`, `channel_*`, `last_synced_at`) — this skill must not write those fields. The route's actor allowlist returns an error if it tries.

## Step-by-step workflow

### Step 0: Load show data and run the freshness gate

This skill is connector-only — there is no mount, no project to discover, no credential file, and no workspace selection to do here. All show data comes from `list_schedulable_shows`; the workspace → pod-id catalog comes from `get_restream_workspaces`.

**Call `list_schedulable_shows`** (no arguments). It returns the `GET /v1/shows` envelope verbatim:

```
{ generatedAt, shows: [...], _fetch: { cfCacheStatus, age, cfRay } }
```

Each call is served fresh — the Data-Worker KV cache and CF edge cache are bypassed server-side, so a successful call is authoritative. The per-show schema is unchanged (same field names, nested host/guest shape as the legacy local `wix-latest.json`). Skill logic downstream of this read step is unchanged.

**Verify the snapshot is actually fresh — retry, then abort.** Check the top-level `generatedAt`. Because the origin stamps `generatedAt` at build time (`new Date()` in `build.ts`), a fresh rebuild is **always** ~0s old — so an age older than ~10 minutes means the read didn't reach a live origin: either the Data-Worker KV cache or the CF edge cache served a stale blob. An old `generatedAt` is **never** "D1 reconcile lag" — a live rebuild reads current D1 and re-stamps `generatedAt`.

A single stale read must **not** abort the run. The cache bypass is honored intermittently (incident 2026-06-08: one read came back ~8h stale and a retry seconds later was current, age ~2s) — so retry with exponential backoff and only abort if it is *still* stale after exhausting attempts:

1. Call `list_schedulable_shows`.
2. Compute `age = (Date.now() - Date.parse(generatedAt)) / 1000`. If `age <= 600`, the snapshot is fresh — **break and proceed**.
3. If stale (or the call errored transiently), back off `2s, 4s, 8s, …` capped at **30s**, then retry.
4. Give up after **5** total attempts. On abort, report the last `generatedAt`, the computed age, and `_fetch.cfCacheStatus` (`HIT` = CF edge cache served a cached body; `MISS`/`BYPASS`/`DYNAMIC` = staleness is upstream in the Data-Worker KV cache). `_fetch.cfRay` pinpoints the request in Cloudflare logs.

Because the tool has no local file to leave behind, a failed or malformed read simply throws and is retried — the "stale leftover file" and false "reconcile-lag" abort classes from the old curl+temp-file design are impossible here. Only **persistent** staleness across all 5 attempts aborts the run.

Filter the `shows` array for entries where:

- `hasLiveScheduled` is `"substack_scheduled"` OR `"restream_paired"` AND
- `restreamKey` is non-null

> ⚠ **Do NOT pre-filter the eligible list using D1's `event_status` field.** The Restream `GET /v2/user/events` endpoint has been observed returning event statuses that disagree with the actual Restream Studio UI — events that read as **Draft** in the browser have come back from the API as `upcoming` (which the poller maps to `event_status: "scheduled"` in D1) or `finished`. Because the poller is the writer behind D1's `event_status`, that field inherits the API's misreporting. Previous versions of this skill performed a `list_restream_events({ event_status: "scheduled" })` pre-flight and unioned the returned `show_id`s into an exclude set; that pre-flight was hard-blocking every workspace's eligible list and the browser pass never ran. The "already Scheduled or Live, skip" decision now lives **only** in Step 2, where `read_page` reads the visible status badge on the actual event row. That is the sole authority.

The eligible list is therefore exactly the set of shows where:

- `hasLiveScheduled` is `"substack_scheduled"` OR `"restream_paired"` AND
- `restreamKey` is non-null

…with **no further D1-based exclusion**. Do not call `list_restream_events({ event_status: "scheduled" })` as a gate. If you want a courtesy log of what D1 currently believes about each show (purely informational — not a filter), call `list_restream_events({ workspace })` (no `event_status`) per workspace and print the rows alongside the eligible list. The decision to schedule or skip still lives in Step 2.

#### Scheduling-horizon filter (default 7 days, overrideable)

After the `hasLiveScheduled`/`restreamKey` filter, apply a **scheduling-horizon filter** to avoid cluttering Restream Studio with events scheduled far in advance. By default this skill only schedules shows whose `scheduledStart` (UTC ISO) is within the next **7 days from now**:

```bash
# Default horizon — overridable via SCHEDULE_HORIZON_DAYS env var or user instruction
HORIZON_DAYS="${SCHEDULE_HORIZON_DAYS:-7}"

# Compute the cutoff in ISO-8601 UTC. Anything with scheduledStart > NOW + horizon is excluded.
HORIZON_CUTOFF=$(node -e "
  const days = Number(process.env.HORIZON_DAYS) || 7;
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  console.log(cutoff.toISOString());
" HORIZON_DAYS="$HORIZON_DAYS")
```

Apply the filter:

```javascript
const cutoffMs = Date.parse(HORIZON_CUTOFF);
const eligible = scheduledShows.filter(
  (s) => Date.parse(s.scheduledStart) <= cutoffMs,
);
```

Shows whose `scheduledStart` is past the cutoff are **deferred** — they stay at their current `hasLiveScheduled` value in D1 (`substack_scheduled` or `restream_paired`) and the Restream draft event remains Draft. A future run inside the window will pick them up. Do NOT write `restream_events` for deferred shows.

**Overriding the window for backfills.** Override the default when the user explicitly asks. Common phrases:

- "schedule all", "ignore the window", "backfill", "no horizon", "all of them"
- An explicit number: "next 14 days", "30-day window", "60 days out"
- `--days N` / `--all` flags if invoked programmatically

When overriding, set `HORIZON_DAYS` to the requested value, or `999999` (effectively "all") when the user says "all". Always confirm the active window in the Step 0 prompt so the operator sees the resolved horizon before any browser action.

Surface deferred shows in the confirmation prompt:

```
Filtered by 7-day horizon — deferred {M} show(s) scheduled >7d out:
  - {showTitle} ({scheduledStart in machine TZ}) — will be picked up on a later run
```

If no eligible shows remain after the `hasLiveScheduled`/`restreamKey` filter (or after the horizon filter), report "No shows ready for Restream scheduling" and stop.

Present the list of eligible shows to the user for confirmation. **Display the machine-local time** (computed per the recipe in "Timezone handling" above) — that's what will actually be entered into the Restream modal. Surface the show-stored TZ wall-clock only when it differs from the machine TZ:

```
Found {N} show(s) ready for Restream scheduling (machine TZ: {MACHINE_TZ_ABBR}):

1. {showTitle} — {LOCAL_DATE} at {LOCAL_TIME_12H} {MACHINE_TZ_ABBR}
   {if localTimeZone differs from machine TZ:
     Show-stored: {scheduledStartLocal} ({localTimeZone})
   }
   Default title: {defaultShowTitle}
   Restream key: {restreamKey (first 8 chars)}…

Proceed with scheduling all?
```

This skill runs from a **single connected Chrome browser profile** — brand-admin scheduling is production support. There is no per-show Chrome-profile routing; the real multi-tenant mechanism is switching Restream **workspaces** in-app (Step 1.5). Use whatever browser is currently connected.

### Step 1: Open browser and navigate to Restream

Create a **new tab** via `tabs_create_mcp`. Navigate to `https://app.restream.io/home`.

Wait 3 seconds for the page to load. Verify the event list is visible via `read_page`:

```
read_page: filter=interactive
```

Look for the events list containing stream titles and "Draft" status badges. If a login prompt appears, stop and tell the user to log in manually.

### Step 1.5: Navigate to the correct workspace

Restream Studio organizes streams into workspaces. The correct workspace must be selected **before** searching for the event — events only appear in their owning workspace.

The workspace is shown in the left sidebar. Use the **seriesId** of the current show to determine which workspace to enter:

| seriesId                    | Target workspace                             |
| --------------------------- | -------------------------------------------- |
| `sotsp-tfl`                 | **Time For Life** (left sidebar)             |
| any other `sotsp-*`         | **Sick of this Show** (left sidebar)         |
| `babm-*` / `fp-*` / `twv-*` | Main account level — no sub-workspace needed |

#### How to navigate

Use `read_page` to read the left sidebar. The account/workspace controls appear at the top of the left panel.

- The **main account** is displayed at the top (e.g., "Sick of this Shit P..." with the account avatar and dropdown arrow).
- **Sub-workspaces** appear below the main account as clickable items (e.g., "Time For Life", "Sick of this Show").

To switch workspaces, `left_click` the target workspace name in the left sidebar. Wait 2 seconds for the event list to reload.

To return to main account level (for BABM/FP/TWV shows), click the main account name at the top of the sidebar.

**Verify the switch** by using `read_page` after clicking — the events shown in the list should now belong to the target workspace. If the workspace names are not visible in the sidebar, use `screenshot` to locate them visually.

This step must run for each show individually — if scheduling multiple shows that belong to different workspaces, re-run this step before each one.

### Step 2: Find the target event (and decide whether to schedule it)

For each show to schedule, find the event row in the Restream list whose title **contains** the show's `defaultShowTitle`. The Restream event titles follow the pattern `"{Default Show Title} | E{N} - {Topic}"` — the `defaultShowTitle` (e.g., "Diogenes Club", "Notes of the Week") will be a prefix.

> **⚠ The draft is a REUSABLE weekly container — match on `defaultShowTitle` ONLY; ignore the episode suffix.** Each series has **one persistent Restream draft** that is reused every week. Between runs it still shows the **previous** episode's title — e.g. today's "Voice From Ukraine" draft may still read `Voice From Ukraine | Russian Aggression Rages On…` from last week's already-aired episode. **That stale-titled draft is exactly the one you want.** You will overwrite its title with today's `showTitle` in Step 4a — reusing-and-renaming the recurring draft IS the intended flow, not clobbering.
>
> Therefore: match strictly on `defaultShowTitle` containment. The `| E{N} - {Topic}` suffix is **irrelevant** to matching. Do **NOT** skip a matched draft, call it "a different show," or treat it as "already aired / finished" because its suffix names a past episode. "Already aired" is an inference from a stale title, **not** a status. The **only** status that decides anything is the live **badge** read below — and a **Draft** badge means *schedule it*, no matter what topic the title currently shows.

Use `read_page` to scan the event list. If the event list is paginated or the target event isn't visible, scroll down to find it.

**This is the sole authority on whether to schedule a given show.** No pre-flight code filter (D1 `event_status`, prior skill state, etc.) is permitted to gate the per-show browser pass. The status badge visible on the event row in the Restream Studio UI — captured via `read_page` — is the only signal that decides what happens next.

Read the status badge on the matching event row via `read_page: filter=interactive` and branch on the visible text:

| Visible badge                                                        | Action                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Draft**                                                            | Proceed to Step 3.                                                                                                                                                                                                                                                                                  |
| **Scheduled**                                                        | Skip this show. Note it in the final report as "already Scheduled — no action." Optionally call `upsert_restream_event` in Step 6 to align `event_status: "scheduled"` with the UI (best-effort sync; do not block on failure). Do NOT click into the Schedule modal — that would clobber the existing pairing or date. |
| **Live** / **In progress**                                           | Skip this show. Note it in the final report as "already Live — no action." Never attempt to reschedule an in-progress event.                                                                                                                                                                        |
| **Finished** (rare — appears on stale rows the user hasn't archived) | Skip this show with a `finished` note in the report. Do NOT reschedule a finished event row — the user would create a fresh draft event instead.                                                                                                                                                    |
| Missing badge / unrecognized text                                    | Surface to the user before acting. Take a screenshot or `read_page` excerpt and ask whether to proceed. Do not guess.                                                                                                                                                                               |

> **API/D1 may disagree with the UI.** Restream's `GET /v2/user/events` endpoint has been observed returning `upcoming` (poller maps to D1 `event_status: "scheduled"`) or `finished` for events that the Studio UI still shows as **Draft**. The reverse can also happen during sync lag. Trust what `read_page` returns from the live UI over anything D1 says. Do not consult D1's `event_status` to make this decision.

**If multiple events match** the same `defaultShowTitle` (e.g., two "Intelligent Masculinity" episodes), prefer the one whose existing title is closest to the show's `showTitle`, or the one with the most recent "Last edited" date. Apply the badge check above to whichever event you select. This tie-break applies **only when two or more drafts** contain the `defaultShowTitle`. If exactly **one** draft matches, use it — **never reject the sole matching draft** because its current (stale) title resembles a *different* episode; that single draft is the recurring container and you rename it in Step 4a.

### Step 3: Open the Schedule modal

Click the **three-dot menu** (⋮) on the right side of the target event row. A dropdown will appear with options including:

- Update titles
- **Schedule** ← select this
- Duplicate
- Invite guests
- Pair channels
- Embed stream
- Delete

Use `find` to locate the "Schedule" option in the dropdown and click it. If `left_click` is blocked, ask the user to click it.

Wait 2 seconds for the "Schedule event" modal to appear.

### Step 4: Fill in the Schedule event modal

The modal contains:

- **Title** — text input (pre-filled with the current event title)
- **Description** — text area
- **Date** — date picker showing format like "Apr 11, 2026"
- **Time** — time picker showing format like "05:30 PM" with timezone label (America/Chicago)
- **"Create an event page on social platforms"** — checkbox (leave as-is)
- **Thumbnail** — image upload (leave as-is)
- **Next** button

#### 4a: Update the title

The Title field is **pre-filled with the draft's current (often previous-episode) title** — overwrite it. This rename is the whole point of reusing the recurring draft: replace whatever stale topic it carries with today's episode. Use `find` to locate the title input, then `form_input` to set it to the show's full `showTitle`:

```
find: "Title input"
form_input: ref=<title_ref>, value="<show.showTitle>"
```

#### 4b: Set the date

The date field is a date picker. Use the **machine-local** `LOCAL_DATE` (`YYYY-MM-DD`) computed in "Timezone handling" — NOT the snapshot's `showDate`, which is rendered in Eastern Time and will be off by one day for late-evening shows when the operator is west of ET:

```
find: "Date input"
form_input: ref=<date_ref>, value="<LOCAL_DATE>"
```

If the date picker doesn't accept ISO format, convert `LOCAL_DATE` to `MM/DD/YYYY`. Do NOT fall back to `show.showDate` or `scheduledStartLocal.split('T')[0]` — both are in non-machine timezones.

#### 4c: Set the time

The time field shows format like "05:30 PM" with the machine timezone label displayed alongside (e.g., `America/Chicago`). Use the **machine-local** time computed in "Timezone handling":

- Try `LOCAL_TIME_24` (`HH:MM`) first — most `<input type="time">` controls accept 24-hour ISO.
- If the picker requires 12-hour with AM/PM, fall back to `LOCAL_TIME_12H` (e.g., `12:00 PM`).

```
find: "Time input"
form_input: ref=<time_ref>, value="<LOCAL_TIME_24 or LOCAL_TIME_12H>"
```

Do NOT use `showStart`, `scheduledStartLocal`, or any other field that comes pre-rendered in the show's stored timezone — Restream's picker is bound to the browser's TZ, so feeding in an Eastern-Time string from a Central-Time machine drifts the schedule by the offset (typically 1 hour).

**IMPORTANT — timezone sanity check:** Read the timezone label rendered next to the Time field via `read_page`. It should match `MACHINE_TZ_IANA` (e.g., `America/Chicago`) — that's the browser's view, not the show's `localTimeZone`. If the modal's label disagrees with `MACHINE_TZ_IANA`, the machine's system clock or browser TZ is mis-set; stop and alert the user. If the modal's label matches the machine but happens to equal the show's `localTimeZone` too (operator and show in the same TZ), no conversion was needed — fine.

#### 4d: Click Next

Use `find` to locate the "Next" button and click it:

```
find: "Next button"
left_click: ref=<next_ref>
```

If `left_click` is blocked, ask the user to click it. Wait 2 seconds for the "Add channels" modal to appear.

### Step 5: Pair the correct channel

The "Add channels" modal shows:

- **"Your Channels" / "Paired Channels"** tab selector
- **Channel list** — each with a name, "Edit" button, and an ON/OFF toggle slider
- **"N of M active"** count
- **"+ Add Channels"** button
- **Date** and **Time** fields (mirror of the previous modal)
- **"Schedule"** button

#### 5a: Find the matching channel

The channel created by the Restream-Worker channel sync (or the legacy `banner-admin schedule-live` CLI) follows the naming format:

```
{showTitle} - {showDate}
```

For example: `"Chronically Illing Out | E27 - Writing, Creating, and Caring For Yourself - 2026-04-13"`

Restream may truncate long channel names in the UI. Use `read_page` to scan the channel list and find the channel whose name **starts with** or **contains** the show's `showTitle`.

```
read_page: filter=interactive
→ Scan for channel matching the show title
```

If no matching channel is found, alert the user — the channel may not have been created yet. Suggest triggering the Restream-Worker channel sync (`POST /sync-channels`, or wait for the next _/30 tick), or creating it manually in Restream Studio.

#### 5b: Toggle the channel ON

Check the current state of the channel's toggle. In the Restream UI:

- **ON** = blue toggle, channel icon is colored (orange/red)
- **OFF** = gray toggle, channel icon is grayed out

If the channel is already ON, skip to 5c.

If the channel is OFF, click the toggle to turn it ON:

```
find: "<channel name> toggle" or locate the toggle adjacent to the channel name
left_click: ref=<toggle_ref>
```

After clicking, verify the toggle changed to ON via `read_page`. The "N of M active" count should increment.

If `left_click` is blocked, ask the user to toggle the channel ON.

#### 5c: Verify the active count

Use `read_page` to confirm the expected channel is now active. The channel should show with a colored icon and blue toggle.

#### 5d: Click Schedule

Use `find` to locate the "Schedule" button at the bottom of the modal and click it:

```
find: "Schedule button"
left_click: ref=<schedule_ref>
```

If `left_click` is blocked, ask the user to click it. Wait 2–3 seconds for confirmation.

Verify the event is now showing as "Scheduled" instead of "Draft" in the event list (if navigated back to the home page), or that a success confirmation appeared.

### Step 6: Write the scheduled-event state

Determine the workspace for this show:

1. Look up the show's `seriesId` in the catalog from `get_restream_workspaces`. Walk `accounts[].workspaces[].podIds[]` and find the workspace whose `podIds` contains the `seriesId`. That workspace's `workspaceName` is the value to pass as `workspace` — **unless `isDefault` is true, in which case OMIT `workspace` entirely** (do NOT pass an empty string). The parent `account.id` tells you which OAuth credential set the tool uses.
2. If no workspace matches the `seriesId`, OMIT `workspace` (the no-workspace case for accounts without a workspace selector).

Then call `upsert_restream_event` with the three write fields (`event_id`, `event_status`, `scheduled_at`), plus `publication` and (conditionally) `workspace`. The tool sets `X-Actor: skill:restream-schedule-live`, `X-Publication`, and the `workspace` query param FOR you — you only supply the values.

```
upsert_restream_event({
  showId: <show.id>,
  publication: "<seriesId prefix before first hyphen — e.g. sotsp / babm / lr>",
  event_status: "scheduled",
  event_id: "<restream event UUID>",
  scheduled_at: "<ISO 8601, e.g. new Date().toISOString()>",
  workspace: "<workspaceName>",   // OMIT for the isDefault / no-workspace case
})
```

**`publication` is required** — it's the `seriesId` prefix before the first hyphen (see the tools table note). The tool maps it to the `X-Publication` header the Data Worker requires; without it the call fails with a missing-publication error.

**Upsert semantics:** if no row exists yet for the (show_id, workspace) pair, the server creates it (the poller may not have seen this channel yet). Otherwise it updates the three fields and leaves channel metadata alone. The response distinguishes the cases:

```json
{ "ok": true, "created": true,  "changed": true, "updated": { "show_id": "...", "restream_workspace": "...", ... } }   // INSERT
{ "ok": true, "created": false, "changed": true, "updated": { ... } }                                                  // UPDATE
```

**`not_found`** means the show itself doesn't exist in D1's `shows` table — most likely the reconcile hasn't picked it up yet, or it was deleted. Surface this clearly; do NOT retry blindly. The user can resolve by running a reconcile or by manually adding the show.

There is no direct-API fallback — a tool error is the failure to report, not a signal to route around it.

### Step 7: Process remaining shows

If there are additional shows to schedule:

1. Navigate back to `https://app.restream.io/home` (or verify the event list is visible).
2. Process the next show starting from Step 1.5 (re-select the workspace) then Step 2.
3. Process shows one at a time. After each show, confirm the state was written before moving to the next.

### Step 8: Close the browser tab

After all shows are processed, close the Restream tab via `tabs_close_mcp`:

```
tabs_close_mcp: tabId=<current_tab_id>
```

### Step 9: Final report

After all shows are processed, present a summary:

```
Restream events scheduled — times shown in {MACHINE_TZ_ABBR}:

1. {showTitle} — {LOCAL_DATE} at {LOCAL_TIME_12H} {MACHINE_TZ_ABBR}
   {if localTimeZone differs from machine TZ:
     Show-stored: {scheduledStartLocal} ({localTimeZone})
   }
   Channel paired: {channel name}
   Status: Scheduled ✓

D1 written for workspace=<workspace> (or __none__).
```

If any shows failed, list them separately with the failure reason.

## Error handling

- **Not logged in:** Stop and tell the user to log in to Restream at `app.restream.io` in Chrome.
- **Event not found:** "Not found" means **no draft row contains the `defaultShowTitle`** — full stop. A draft whose title shows a *previous* episode's topic (e.g. a "Voice From Ukraine" draft still reading last week's headline) is **found** and is the recurring container to reuse — do NOT report it as "not found" or "a different/aired show." Only when there is genuinely no draft containing the series name does the user need to create one in Restream Studio (+ New Stream). This skill schedules existing draft events; it does not create new ones.
- **Event already scheduled / Live / Finished:** Step 2's `read_page` badge check is the only place this decision is made. Skip the show, note it in the final report, and optionally best-effort call `upsert_restream_event` to align D1 (`event_status: "scheduled"` or `"finished"`). Never consult D1's `event_status` as a pre-flight filter — the API behind it has been observed misreporting Draft events as `upcoming`/`finished`.
- **Channel not found:** The Substack channel for this show hasn't been created yet. Suggest triggering the Restream-Worker channel sync (`POST /sync-channels`, or wait for the next _/30 tick), or `banner-admin schedule-live` to create it manually.
- **Channel toggle doesn't respond:** Try clicking the toggle label/row instead of the switch element itself. If `left_click` is blocked, ask the user to toggle it.
- **Schedule button fails:** The Schedule button may be disabled if required fields are missing (date, time, at least one channel). Verify all fields are set before clicking.
- **Multiple draft events match:** When the same `defaultShowTitle` matches more than one draft event (e.g., two "Intelligent Masculinity" episodes from different weeks), prefer the one whose title is most similar to the show's `showTitle`, or the one with the most recent "Last edited" date. If ambiguous, present both to the user and ask them to choose.
- **Extension blocks tools:** Use `read_page` for verification and `form_input` for data entry. If `left_click` is blocked, ask the user to click the element.
- **`upsert_restream_event` errors transiently (`5xx`/network):** Retry the tool call (up to 3×, brief backoff — 500 ms → 1 s → 2 s). The tool handles upsert semantics atomically; there is no read-then-write race. After retries exhaust, report the failure for this show and continue.
- **A tool returns an authorization error:** The connector session isn't authorized for admin scheduling — you need a brand-admin or super-admin role on your BroadBanner account. Stop the run and tell the user; there is no fallback path.
- **A tool returns a request-shape error (`invalid_field`, `field_not_allowed_for_actor`, missing publication, `not_found` on the show):** Fail loud with the message. Do NOT retry — a 4xx-class error indicates a bad request or a missing show in D1. For `not_found`, suggest a reconcile or manual add.

## Key technical notes

- **This skill schedules EXISTING draft events** — it does not create new Restream events. Events are created in Restream Studio when a new stream is set up via "+ New Stream". This skill finds those draft events and schedules them with the correct date/time/channel.
- **Match events by `defaultShowTitle`** — the `defaultShowTitle` field (e.g., "Diogenes Club", "Intelligent Masculinity") is the stable series name. Restream events use titles like "Diogenes Club | E10 - You Cease, We Fire" which contain the default title as a prefix.
- **Channel names follow the format `"{showTitle} - {showDate}"`** — these are created by the Restream-Worker channel sync or the `banner-admin schedule-live` CLI command. The UI may truncate long names, so match by prefix/containment rather than exact match.
- **Restream's Schedule modal operates in the BROWSER's local timezone, not the show's stored timezone.** The TZ label next to the Time field reflects the operator's machine (typically `America/Chicago`). The show's `localTimeZone` is independent (often `America/New_York`) — they are NOT expected to match. Always convert `scheduledStart` (UTC) → machine-local wall-clock via the "Timezone handling" recipe and feed those values to the Date/Time pickers. Never use `showDate`, `showStart`, or `scheduledStartLocal` directly — those are pre-rendered in the show's stored TZ (or Eastern Time for legacy snapshot compatibility) and will drift the schedule by the offset between the show TZ and the machine TZ.
- **Process shows one at a time** — each scheduling pass interacts with the Restream modal, which has state. Complete one show fully before moving to the next.
- **Only schedule Draft events — and the decision lives in the browser, not in D1.** Step 2's `read_page` of the event row's status badge is the sole authority. Do not gate scheduling on D1's `event_status` field: the poller writes that field from Restream's `GET /v2/user/events` response, which has been observed reporting `upcoming`/`finished` for events the Studio UI still shows as Draft. Letting D1 gate the pass caused the skill to miss scheduling for every workspace.
- **Multi-tenant switching is in-app, not by browser profile.** This skill runs from a single connected Chrome profile; the real per-tenant mechanism is switching Restream workspaces in the sidebar (Step 1.5). Workspace is part of D1 row identity `(show_id, restream_workspace)`, so each workspace's scheduling state is isolated.
- **State lives in D1, reached via the connector tools** — the legacy `Social-Distribution/restream-event-state-*.json` files are frozen as of the Phase 3 cutover (2026-05-13). All reads and writes from this skill flow through `list_restream_events` / `upsert_restream_event`. The poller (`banner-blast restream-poller`) shares the table via its own path and owns channel metadata; workspace is part of row identity so each workspace's scheduling state is isolated. See `RESTREAM-EVENT-STATE-TO-D1-MIGRATION-PLAN.md` (in the BroadBanner workspace root) for the architectural reasoning.
