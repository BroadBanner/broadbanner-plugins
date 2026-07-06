---
name: substack-schedule-live
description: "Schedule a Substack live stream from BroadBanner show data. Use this skill when the user says 'schedule the lives', 'schedule substack streams', 'set up the live streams', or wants to create scheduled live video events on Substack for upcoming podcast episodes. Reads show data from the BroadBanner Gateway snapshot endpoint, automates the Substack 'Go live with stream key' form via browser, invites co-hosts, captures stream credentials, and PATCHes them back to D1 through the Gateway BFF. Gateway-only auth (no HMAC); requires an admin-tier capability token."
---

# Substack Schedule Live

Schedule upcoming podcast live streams on Substack using show data from the BroadBanner Gateway (`https://gateway.broadbanner.com/v1`). The Gateway proxies snapshot reads and managed-field writes to the Data Worker — this skill never talks to `data.broadbanner.com` directly. It automates the "Go live with stream key" modal in the Substack publisher dashboard, fills in the title and schedule, invites co-hosts, captures the generated stream URL and stream key, and PATCHes the results back to D1 via the Gateway.

This skill authenticates **gateway-only** with a capability token Bearer. There is no HMAC fallback. If the Gateway is unreachable, stop and report — do not attempt to sign requests against `data.broadbanner.com`.

## Prerequisites

- The user must be logged in to the correct Substack publication in Chrome before running.
- The BroadBanner Gateway must be reachable at `https://gateway.broadbanner.com` and the workspace must hold an **admin-tier** capability token at `<PROJECT_ROOT>/.creds/gateway.token` carrying `caps: ["shows:read","shows:write"]` (auto-issued for D1.contributors.is_admin === 1 by `banner-blast init` / `banner-admin init`). See `references/gateway-auth.md` for the auth pattern.
- D1 must contain shows with `hasLiveScheduled === "title_customized"` — pulled from the Gateway snapshot endpoint in Step 0.

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

## Timezone handling (CRITICAL — read before Step 4)

The snapshot provides two scheduling-related fields per show:

| Field                 | Meaning                                                             | Example                                  |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `scheduledStart`      | UTC ISO timestamp. Source of truth.                                 | `2026-04-14T17:00:00.000Z`               |
| `scheduledStartLocal` | Wall-clock time in the **show's** `localTimeZone` (NOT the user's). | `2026-04-14T13:00:00` (America/New_York) |
| `localTimeZone`       | The show's stored timezone (often `America/New_York`).              | `America/New_York`                       |

Substack's "Schedule for a future date" input is `type="datetime-local"` — the browser interprets the value as wall-clock time **in the browser's timezone**. The browser runs on the operator's real machine (typically `America/Chicago`); the show's stored `localTimeZone` is usually `America/New_York`. Feeding `scheduledStartLocal` straight in records the show at the wrong wall-clock time.

> **The conversion target is the BROWSER's timezone — not the bash environment's.** In a scheduled/Cowork run, this skill's shell executes in a sandbox whose `TZ` is often **UTC**, while Chrome runs on the operator's machine. So `new Date(utc).getHours()` in bash (which reads the *shell's* ambient zone) produces a value that is wrong by the full UTC offset (5–6h), not just the 1-hour ET↔CT case. **Never rely on the shell's ambient timezone.** Resolve the browser's IANA zone explicitly and convert against it.

**Resolve the browser timezone (`BROWSER_TZ`) once, before computing any datetime.** Resolve it as soon as a browser is connected — Step 0.5 selects the Chrome profile, and the `Intl` eval is environment-level (works on any open tab; no Substack navigation needed). If you present the Step 0 eligible-show preview *before* the browser is connected, use the config/ask fallbacks below, or defer the local-time columns until after Step 0.5. Re-confirm at Step 4 if in doubt. Resolution order:

1. **Browser eval (authoritative).** With any tab active in the selected profile:
   `javascript_tool` → `Intl.DateTimeFormat().resolvedOptions().timeZone` (e.g. `"America/Chicago"`). Use that as `BROWSER_TZ`.
2. **If `javascript_tool` is blocked:** read `operatorTimeZone` from `broadbanner.config.json` if present.
3. **If still unresolved:** ask the user "What timezone is your computer set to?" and accept an IANA name (e.g. `America/Chicago`).

Do **not** fall back to the shell's own timezone — that is the bug this replaces.

**Then convert `scheduledStart` (UTC) → `BROWSER_TZ` wall-clock**, passing the zone explicitly so the result is independent of the shell's ambient `TZ`:

```bash
# SCHEDULED_START_UTC = the show's scheduledStart field; BROWSER_TZ resolved above.
SCHEDULED_START_UTC="2026-04-14T17:00:00.000Z"
BROWSER_TZ="America/Chicago"

DATETIME_LOCAL=$(SS="$SCHEDULED_START_UTC" BTZ="$BROWSER_TZ" node -e '
  const d = new Date(process.env.SS), tz = process.env.BTZ;
  if (!tz || isNaN(d.getTime())) { console.error("bad SCHEDULED_START_UTC/BROWSER_TZ"); process.exit(2); }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]));
  const hh = p.hour === "24" ? "00" : p.hour;  // Intl emits 24 for midnight in some envs
  console.log(`${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`);
')
# e.g. "2026-04-14T12:00" for BROWSER_TZ=America/Chicago (1:00 PM ET → 12:00 PM CT)
[ -z "$DATETIME_LOCAL" ] && { echo "TZ conversion failed — do not proceed to fill the form" >&2; exit 1; }

LOCAL_DATE="${DATETIME_LOCAL%T*}"   # "2026-04-14"
LOCAL_TIME="${DATETIME_LOCAL#*T}"   # "12:00"

# TZ abbreviation for the user-facing summary — also computed in BROWSER_TZ:
MACHINE_TZ_ABBR=$(BTZ="$BROWSER_TZ" node -e "
  console.log(new Intl.DateTimeFormat('en-US', { timeZone: process.env.BTZ, timeZoneName: 'short' })
    .formatToParts(new Date()).find(p => p.type === 'timeZoneName').value);
")  # e.g. "CDT" / "CST"
```

Use `DATETIME_LOCAL` (the `BROWSER_TZ`-converted value) — **never `scheduledStartLocal`**, **never an ambient-`getHours()` value** — for the datetime-local input in Step 4e.

When you report the show list to the user (Step 0) and the final summary (Step 11), display both the machine-local time (what was actually scheduled) and, when it differs, the show's stored timezone wall-clock — so the user can sanity-check the conversion at a glance.

## Step-by-step workflow

### Step 0: Discover the project, load gateway credentials, fetch snapshot

**0a. Discover the project.** The Cowork dispatch enumerates the user's mounted workspaces in the system prompt under "User selected a folder". For each candidate, attempt a direct Read of `<workspace>/broadbanner.config.json`:

- Zero hits → call `mcp__cowork__request_cowork_directory`, ask the user to add their BroadBanner workspace, retry.
- One hit → use it.
- Multiple hits → list them, ask which to use.

Capture `PROJECT_ROOT` (the mounted workspace path, e.g. `/Users/<user>/SickOfThisShitPublications`). Also capture the `chromeProfiles` block from `broadbanner.config.json` if present — you'll need it in Step 0.5 for profile routing.

**0b. Load the gateway capability token.** Read it directly from the workspace `.creds/` directory:

```
<PROJECT_ROOT>/.creds/gateway.token   ← cap-token Bearer for Authorization header
```

If the file is missing, empty, or carries only `posts:write` (i.e. a non-admin token), **stop immediately** and tell the user:

> Workspace gateway token not found or insufficient at `<PROJECT_ROOT>/.creds/gateway.token`. This skill needs an admin-tier token with `shows:read` + `shows:write`. Re-run `banner-blast init <project-id> --update` (or `banner-admin init`) on an account where `is_admin === 1` in D1, or mint one manually with `banner-admin tokens issue --for <you> --caps posts:write,shows:read,shows:write`.

Set the constants:

```
API_BASE = "https://gateway.broadbanner.com/v1"
AUTH_HDR = "Authorization: Bearer ${GATEWAY_TOKEN}"
```

**Do not** read from `~/.broadbanner/`, do not look for `.env.json`, do not load `BROADBANNER_ENC_PASSPHRASE`, do not attempt HMAC signing. Gateway-only.

**Fail-fast rule:** Steps 0a and 0b both complete before any browser work begins. A successful Substack post followed by a failed PATCH is worse than catching the credential problem upfront.

**0c. Fetch the snapshot via the Gateway** (`GET /v1/shows`):

```bash
# Always bypass caches on the read — the snapshot endpoint is fronted by
# a KV cache (Data-Worker) and may sit behind a CF edge cache on the
# gateway hostname. Two query params cover both layers:
#   - `?fresh=1` — Data-Worker honors this and skips its KV cache, rebuilding
#     from D1. Forwarded by the Gateway (since 2026-05-21).
#   - `?_cb=<epoch>` — unique URL each run, defeats any CF edge cache that
#     might otherwise serve a stale gateway response.
# Without these, scheduled-task runs can read multi-day-stale data (incident
# 2026-05-21: 2-day-old snapshot caused tonight's eligible show to be missed).
#
# Wrapped in a function because the freshness gate below RETRIES it: the
# cache-bypass is not always honored on the first try (incident 2026-06-08:
# fresh=1 returned an ~8h-stale snapshot, then a plain re-fetch seconds later
# returned current data — so the eligible show only appeared on retry). Each
# call uses a NEW _cb so every attempt is a distinct URL to the edge.
# The body is written with a SHELL redirect (`>`), NEVER curl's `-o`. In Cowork
# / scheduled sandboxes, curl's own file opens under /tmp fail with "write error
# 23" while shell redirection to the same path succeeds. With `-o`, a failed
# write silently leaves the body file holding a PREVIOUS run's snapshot, which
# the freshness gate then misreads as live-but-stale data — the false "reconcile
# lag" abort of 2026-06-11, where the gate parsed a 42h-old leftover while the
# live origin was 0s fresh. Unique temp files (mktemp) + an exit-code + JSON
# check make a failed fetch a hard, retryable error instead of a silent stale read.
SNAP_BODY="$(mktemp 2>/dev/null || echo "/tmp/bb-snap.$$.json")"
SNAP_HDR="$(mktemp 2>/dev/null || echo "/tmp/bb-hdr.$$.txt")"

fetch_snapshot() {
  local cb="fresh=1&_cb=$(date +%s)-$RANDOM"
  : > "$SNAP_BODY"
  # Try capturing headers (-D) too; if the sandbox rejects that file open,
  # retry without -D so the body still lands via the shell redirect. Headers
  # are best-effort (diagnostics only); body correctness never depends on them.
  curl -sS "${API_BASE}/shows?${cb}" \
    -H "${AUTH_HDR}" -H "Cache-Control: no-cache" -H "Pragma: no-cache" \
    -H "Accept: application/json" \
    -D "$SNAP_HDR" > "$SNAP_BODY" 2>/dev/null
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    : > "$SNAP_HDR" 2>/dev/null || true
    curl -sS "${API_BASE}/shows?${cb}" \
      -H "${AUTH_HDR}" -H "Cache-Control: no-cache" -H "Pragma: no-cache" \
      -H "Accept: application/json" > "$SNAP_BODY" 2>/dev/null
    rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "fetch_snapshot: curl transport error (exit $rc)" >&2
    return 1
  fi
  # The body MUST be a snapshot envelope. An auth-error JSON, truncated read, or
  # empty file fails this and is treated as a retryable FETCH failure — never
  # parsed for a (missing/old) generatedAt off a non-snapshot or stale file.
  if ! jq -e '.generatedAt and (.shows | type == "array")' "$SNAP_BODY" >/dev/null 2>&1; then
    echo "fetch_snapshot: response is not a valid snapshot envelope" >&2
    return 1
  fi
  return 0
}
```

The `-D` flag dumps the response headers so the freshness gate below can report cache provenance (`cf-cache-status`, `x-cache`, `cf-ray`) on abort — best-effort, since `$SNAP_HDR` may be empty in a write-restricted sandbox.

After the freshness gate below confirms the snapshot is current, parse `$SNAP_BODY` and filter the `shows` array for entries where `hasLiveScheduled === "title_customized"`. If none are found, report "No shows ready to schedule" and stop.

The Gateway proxies this to the Data Worker's snapshot endpoint with the inbound query string preserved, so `?fresh=1` reaches the Data-Worker's snapshot route (the `?_cb` param is harmless ballast that just makes each URL unique). Response shape is unchanged from `shows[]`/`hosts[]`/`guests[]` nesting; the per-show field set as of migration 0016 carries `hasLiveScheduled` (new verbose vocabulary), `restreamKey`, and `substackLivestreamUrl` (renamed from `livestreamLink`). The rest of this skill operates against the parsed snapshot, treating it as the source of truth for read state.

**Verify the snapshot is actually fresh — retry, then abort.** Sanity-check `generatedAt` (top-level field on the snapshot envelope). If it's older than ~10 minutes, you are not holding a live response. Because the origin stamps `generatedAt` at build time (`new Date()` in `build.ts`), a successful `fresh=1` rebuild is **always** ~0s old — so an old age means one of: (a) a **failed fetch this run** left a stale `$SNAP_BODY` leftover (the most common cause, now caught by `fetch_snapshot`'s exit-code + JSON check); (b) the Data-Worker KV cache served a stale blob (`x-cache: hit`, i.e. `fresh=1` didn't reach origin); or (c) the CF edge cache served a cached body (`cf-cache-status: HIT`). It is **never** "D1 reconcile lag" — a live rebuild reads current D1 and re-stamps `generatedAt`, so reconcile state cannot manifest as an old `generatedAt`.

A single stale read must **not** abort the run. The cache bypass is honored intermittently — incident 2026-06-08: `fresh=1` returned an ~8h-stale snapshot and the gate hard-aborted, silently skipping a real `title_customized` show that was due that night; a manual re-fetch seconds later returned current data (age ~2s). So the gate **re-fetches with backoff** and only aborts if it is *still* stale (or still unparseable) after exhausting retries. Treat both stale-age and parse-failure as retryable — a transient malformed/cached response can cause either, and retrying is cheap. The final abort message captures the cache headers so a genuine, persistent staleness is self-diagnosing.

```bash
MAX_ATTEMPTS="${FRESHNESS_MAX_ATTEMPTS:-5}"   # total snapshot fetches before giving up
FRESH_OK=0
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  # Fetch FIRST, inside the loop. fetch_snapshot returns non-zero on any
  # transport error or non-snapshot body — those are retryable and must NOT be
  # confused with "stale data". The previous design fetched outside the loop and
  # ignored curl's exit code, so a failed write left it parsing a stale leftover
  # file (the 2026-06-11 false "reconcile lag" abort).
  if ! fetch_snapshot; then
    echo "freshness-gate attempt ${attempt}/${MAX_ATTEMPTS}: fetch failed (transport error or non-snapshot body); will retry" >&2
  else
    GENERATED_AT=$(jq -r '.generatedAt' "$SNAP_BODY" 2>/dev/null)

    # Cache provenance for the abort line (best-effort; $SNAP_HDR may be empty in
    # a write-restricted sandbox). IMPORTANT — how to read an old age here:
    #   `generatedAt` is stamped by the ORIGIN at BUILD time (`new Date()` in
    #   build.ts:505), so a genuine `fresh=1` rebuild is ALWAYS age ~0. The
    #   "neither header + old age = reconcile lag" reading is a FALLACY — a live
    #   origin rebuild can't return an old generatedAt. If you see x-cache:bypassed
    #   AND an old generatedAt, you are NOT looking at a live response: it's a
    #   stale LOCAL artifact (leftover $SNAP_BODY). The only real stale-cache
    #   cases are x-cache:hit (fresh=1 didn't reach origin) or cf-cache-status:HIT
    #   (CF edge served a cached body). cf-ray = request id for Cloudflare logs.
    CACHE_DIAG=$(grep -iE '^(cf-cache-status|x-cache|cf-ray|age):' "$SNAP_HDR" 2>/dev/null \
      | tr -d '\r' | paste -sd' ' -)
    [ -z "$CACHE_DIAG" ] && CACHE_DIAG="(no cache headers captured)"

    # Env var MUST precede `node` so it lands in process.env (not argv). Exits
    # non-zero on parse failure → the case-check treats it as a retryable miss.
    AGE_SECONDS=$(GA="$GENERATED_AT" node -e '
      const raw = process.env.GA || "";
      const ts = new Date(raw).getTime();
      if (!Number.isFinite(ts)) {
        console.error("freshness-gate: could not parse generatedAt=" + JSON.stringify(raw));
        process.exit(2);
      }
      console.log(Math.floor((Date.now() - ts) / 1000));
    ')

    case "$AGE_SECONDS" in
      ''|*[!0-9-]*)
        echo "freshness-gate attempt ${attempt}/${MAX_ATTEMPTS}: unparseable generatedAt=$GENERATED_AT, age=$AGE_SECONDS | $CACHE_DIAG" >&2
        ;;
      *)
        if [ "$AGE_SECONDS" -le 600 ]; then
          FRESH_OK=1
          break   # snapshot is fresh — proceed
        fi
        echo "freshness-gate attempt ${attempt}/${MAX_ATTEMPTS}: snapshot ${AGE_SECONDS}s old (generatedAt=$GENERATED_AT) | $CACHE_DIAG" >&2
        ;;
    esac
  fi

  # Failed fetch, stale, or unparseable — back off (2s,4s,8s,…, capped 30s) and
  # loop; the next iteration re-fetches with a fresh _cb.
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep_s=$(( 2 ** attempt )); [ "$sleep_s" -gt 30 ] && sleep_s=30
    sleep "$sleep_s"
  fi
  attempt=$(( attempt + 1 ))
done

if [ "$FRESH_OK" -ne 1 ]; then
  echo "ABORT: could not obtain a fresh snapshot after ${MAX_ATTEMPTS} attempts — last generatedAt=$GENERATED_AT, age=$AGE_SECONDS — $CACHE_DIAG" >&2
  echo "  → Diagnose by header: x-cache:hit = fresh=1 not reaching origin (Gateway/KV); cf-cache-status:HIT = CF edge cache. An old age with NO cache headers (or x-cache:bypassed) is NOT reconcile lag — generatedAt is build-time, so a live rebuild is always ~0s; an old value means a stale LOCAL file or a failed fetch this run. Sanity-check the live origin directly: curl \"\${API_BASE}/shows?fresh=1&_cb=\$(date +%s)\" -H \"\${AUTH_HDR}\" | jq .generatedAt — if THAT is current, the fault is local, not infra. cf-ray pinpoints the request in Cloudflare logs." >&2
  exit 1
fi
```

The fetch-inside-the-loop + exit-code/JSON check means a failed write or transport error is a *retryable fetch miss*, not a silently-parsed stale leftover — the leftover-file path that produced the 2026-06-11 false abort is closed. A transient stale/cached read no longer skips a real eligible show either; the loop re-fetches until the snapshot is current. Only **persistent** failure across all `MAX_ATTEMPTS` aborts the run — and the abort message points at the real culprits (failed local fetch, KV, or CF edge), not a phantom reconcile fault — while still treating unknown-freshness as stale rather than proceeding on data it cannot verify.

#### Scheduling-horizon filter (default 7 days, overrideable)

After the `hasLiveScheduled === "title_customized"` filter, apply a **scheduling-horizon filter** to keep upcoming-week shows from being scheduled too far in advance — clutter on the Substack publisher dashboard is the operator's stated concern. By default this skill only schedules shows whose `scheduledStart` (UTC ISO) is within the next **7 days from now**:

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

Apply the filter to the `hasLiveScheduled === "title_customized"` set:

```javascript
const cutoffMs = Date.parse(HORIZON_CUTOFF);
const eligible = readyShows.filter(
  (s) => Date.parse(s.scheduledStart) <= cutoffMs,
);
```

Shows whose `scheduledStart` is past the cutoff are **deferred** — they remain `hasLiveScheduled === "title_customized"` in D1 and will be picked up on a future run once they fall inside the window. Do NOT PATCH anything to "defer" them; the state is correct as-is.

**Overriding the window for backfills.** The default exists to keep the platform tidy. Override it when the user explicitly asks for a wider sweep — common phrases include:

- "schedule all ready shows", "ignore the window", "backfill", "no horizon", "all of them"
- An explicit number: "schedule the next 14 days", "30-day window", "60 days out"
- `--days N` / `--all` style flags if invoked programmatically

When overriding, set `HORIZON_DAYS` to the requested value, or set it to `999999` (effectively "all") if the user says "all" or "no window". Always confirm the override in the Step 0 confirmation prompt so the operator sees what window they're actually using.

When presenting the list to the user (below), mention any shows that were deferred by the horizon filter so the operator knows what was _not_ scheduled in this run:

```
Filtered by 7-day horizon — deferred {M} show(s) scheduled >7d out:
  - {showTitle} ({scheduledStart in machine TZ}) — will be picked up on a later run
```

Also load `broadbanner.config.json` from the brand workspace root (alongside `Social-Distribution/`). Capture the `chromeProfiles` block (if present) — you'll need it in Step 0.5 to pick the correct browser profile per show. If the block is absent, profile-routing is disabled and the skill will use the currently-selected browser for every show.

Present the list of ready shows to the user for confirmation. **Display the machine-local time** (computed per the recipe in "Timezone handling" above) so the user can verify what will actually be entered into Substack. Surface the show's stored timezone only when it differs from the machine TZ — that's the case where the conversion is meaningful and worth eyeballing.

```
Found {N} show(s) ready to schedule (machine TZ: {MACHINE_TZ_ABBR}):

1. {showTitle} — {LOCAL_DATE} at {LOCAL_TIME} {MACHINE_TZ_ABBR}
   {if localTimeZone differs from machine TZ:
     Show-stored: {scheduledStartLocal} ({localTimeZone}) — will be entered as {LOCAL_DATE}T{LOCAL_TIME}
   }
   Publication: {brand}
   Primary host: {primaryHost.name}
   Co-hosts: {hosts + guests names}

Proceed with scheduling all?
```

### Step 0.5: Select the correct Chrome profile

For each show, before any browser action, resolve and switch to the right Claude-in-Chrome profile based on the show's `seriesId` and `brand`. See `references/chrome-profile-routing.md` for the full algorithm.

Quick version:

1. Look up `chromeProfiles.bySeriesId[show.seriesId]` from the config loaded in Step 0. If set, that's the target deviceId.
2. Else look up `chromeProfiles.byBrand[show.brand]`. If set, that's the target deviceId.
3. Else: skip the switch (no routing rule).

If a target deviceId resolved:

```
list_connected_browsers → confirm <resolved deviceId> is in the connected list (ignore the `name` field — it's a volatile ordinal)
select_browser({ deviceId: <resolved deviceId> })
```

Skip `select_browser` if the current browser is already that profile. If the resolved deviceId is not in the connected list, **stop and tell the user** — running on the wrong account will schedule under the wrong identity. Suggest pairing the missing profile via `switch_browser`.

When iterating multiple shows, **re-resolve and re-switch before each show**. A run can include shows from different pods (e.g., `sotsp-tfl` and `sotsp-cio`) that target different profiles. The existing "process shows grouped by publication" guidance still applies — group also by resolved profile to minimize switches.

Run this resolution once for the show being acted on **before** Step 1 (Mark show as in-progress). The mark-in-progress step is a JSON write, but the rest of this skill is browser-driven, so the profile switch must precede every show's browser interaction.

### Step 1: Mark show as in-progress

For the show being processed, PATCH the Gateway to set `schedule_state = "substack_scheduling"`. This prevents duplicate scheduling if the skill is interrupted and re-run.

```bash
curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  -d '{"schedule_state":"substack_scheduling"}'
```

Verify the response has `ok: true` (either `changed: true` or `changed: false` is fine — both mean the row reflects the desired state). On any non-2xx, abort the run for this show and surface the error to the user — see the retry policy in `references/gateway-auth.md`.

The Gateway stamps `X-Actor` from the cap-token's `sub` claim automatically, so the change_log will record the user's email (or `skill:substack-schedule-live` if the token was issued for the skill specifically). Skills do not set `X-Actor` themselves.

Note: the D1 column is named `schedule_state`; the snapshot endpoint surfaces it on the wire as `hasLiveScheduled` for backward compat with consumers that read the legacy field name. Values use the verbose vocabulary established in migration 0016: `unscheduled`, `title_customized`, `substack_scheduling`, `substack_scheduled`, `live`, `completed`. The pre-0016 set (`pending`/`ready`/`in_progress`/`scheduled`) is no longer accepted — the CHECK constraint will reject it.

### Step 2: Pre-check for existing scheduled live

Before opening the scheduling modal, verify that a live stream with the same title hasn't already been scheduled on Substack. This catches cases where a previous run partially completed (e.g., the live was created but the JSON wasn't updated) or where someone scheduled the live manually.

#### 2a: Navigate to scheduled lives page

Create a **new tab** via `tabs_create_mcp` and navigate to the publication's scheduled lives page. Derive the URL from the show's `substackLiveUrl` by replacing the path:

- For `sickofthis.substack.com` → `https://sickofthis.substack.com/publish/live-videos/scheduled`
- For `bannerandbackbone.com` → `https://bannerandbackbone.com/publish/live-videos/scheduled`
- General pattern: `https://{publication_domain}/publish/live-videos/scheduled`

Wait 3 seconds for the page to load.

#### 2b: Check for matching title

Use `read_page` (or `get_page_text`) to read the scheduled lives listing. Look for a live stream entry whose title matches the show's expected title (case-insensitive comparison).

```
read_page: filter=all
→ Search page content for the show title
```

#### 2c: Decide whether to proceed

- **If a matching title is found:** This show is already scheduled on Substack. PATCH the Gateway to set `schedule_state = "substack_scheduled"` (do NOT include `substack_livestream_url` or `restream_stream_key` in this payload — we don't have fresh values from Substack, and PATCH leaves omitted fields alone so existing values are preserved):

  ```bash
  curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}" \
    -H "${AUTH_HDR}" \
    -H "Content-Type: application/json" \
    -d '{"schedule_state":"substack_scheduled"}'
  ```

  Close the tab via `tabs_close_mcp`. Log the skip reason and move to the next show (Step 9).

- **If no matching title is found:** Close the pre-check tab via `tabs_close_mcp` and proceed to Step 3 to schedule normally.

### Step 3: Open browser and navigate to scheduling modal

Create a **new tab** via `tabs_create_mcp` for each scheduling session. Do NOT reuse existing tabs — extension state can carry over and cause interference.

Navigate to the show's `substackLiveUrl`:

```
navigate: {show.substackLiveUrl}
```

Wait 3 seconds for the page to load. Verify the modal loaded via `read_page`:

```
read_page: filter=interactive
```

Look for the dialog element containing `"Enter a title..."` textbox. If the modal is not visible, the URL should have triggered it — look for the modal or try clicking a "Go live" button on the page. If a login prompt appears instead, stop and tell the user to log in manually.

**IMPORTANT:** Substack renders TWO dialog elements in the DOM. The first (lower ref numbers) is the main "Go live" modal. The second (higher ref numbers) appears when the co-host invitation modal opens. When using `find`, it may return duplicate results from both dialogs — always use the **second/higher-numbered ref** for form inputs, or use `read_page` with `ref_id` to scope to the correct dialog.

### Step 4: Fill in the "Go live with stream key" modal

Fill fields in this order: **title → co-hosts toggle → schedule toggle → date/time**. Setting the date/time last avoids extension interference that can occur when the datetime-local input is modified.

#### 4a: Enter the title

Use `find` to locate the title input, then `form_input` to set it:

```
find: "title input Enter a title"
→ Use the higher-numbered ref (second dialog)

form_input: ref=<title_ref>, value="<SHOW_TITLE>"
```

#### 4b: Confirm "This video is for..." setting

Leave set to "Everyone" (the default). Only change if the show data explicitly specifies a different audience tier. Verify via `read_page` that the "everyone" radio is checked.

#### 4c: Select the primary host

The show's `primaryHost` object identifies who should be selected in the "The person going live is..." dropdown. This dropdown is a standard HTML `<select>` element with `<option>` children.

**If `primaryHost` is `null`:** skip this step. Leave the dropdown at its default value.

**If `primaryHost` is present:** use `read_page` to check the current selection. The dropdown options include display names like "Nick Paro", "Beth Cruz", "Banner & Backbone Media". If the current selection doesn't match `primaryHost.name`, use `form_input` on the `<select>` ref:

```
form_input: ref=<select_ref>, value="<primaryHost.name>"
```

The `form_input` tool can set a `<select>` by option text or value. Use the display name for matching.

If no exact match, try a case-insensitive partial match. If still no match, leave the default and note it in the report.

#### 4d: Enable "Invite co-hosts"

Use `find` to locate the "Invite co-hosts" toggle, then click it. After enabling, the main button should change from "Generate stream key" to "Continue". Verify via `read_page`.

```
find: "Invite co-hosts toggle"
→ Click the toggle ref

read_page: ref_id=<dialog_ref>
→ Confirm button text is now "Continue"
```

#### 4e: Enable "Schedule for a future date" and set date/time

**Do this LAST** to avoid extension interference with the datetime-local input.

Use `find` to locate the schedule toggle and click it. Wait 1 second for the datetime-local input to appear.

The date/time input is `type="datetime-local"` and accepts ISO format directly via `form_input`:

```
find: "Schedule for a future date toggle"
→ Click the toggle ref (use higher-numbered ref if duplicates)

find: "datetime-local input"
→ Returns the datetime input ref

form_input: ref=<datetime_ref>, value="<DATETIME_LOCAL>"
```

`DATETIME_LOCAL` is the **`BROWSER_TZ` wall-clock** value computed in "Timezone handling" above (e.g., `2026-04-14T12:00` for `BROWSER_TZ=America/Chicago` on a 1:00 PM ET show). It is converted against the browser's resolved zone, NOT the shell's ambient `TZ`. **Do NOT** use `scheduledStartLocal` directly (it's in the show's stored TZ) and **do NOT** use any value produced by `new Date(...).getHours()` in the shell (in a sandbox the shell is often UTC, drifting the schedule by the full offset). Both bugs put the stream at the wrong hour.

**Do NOT use the calendar picker.** It opens a complex date/time widget that is difficult to automate and can change other modal fields when clicked. Always use `form_input` with ISO format.

#### 4f: Leave Delivery checkboxes checked

Both delivery notification checkboxes should remain checked (they are checked by default):

- "Notify my subscribers via email to add this live video to their calendars" (only appears when schedule is enabled)
- "Notify my subscribers via email when my live video starts"

#### 4g: Click "Continue"

The button should read "Continue" (because co-hosts toggle is ON). Click it to advance to the co-host invitation modal. If `left_click` is blocked by extension interference, ask the user to click the button.

Wait 2 seconds for the "Invite co-hosts" modal to appear.

### Step 5: Invite co-hosts

The "Invite co-hosts" modal (second dialog) has a search field and displays matching Substack users with checkboxes.

#### 5a: Build the co-host list

Combine all entries from `hosts` and `guests` arrays. The `primaryHost` has already been separated from the `hosts` array in the snapshot (D1 stores them in distinct tables — `series.primary_host_id` for the primary, junction rows in `show_hosts` for the cohosts), so no additional filtering is needed — every person in these arrays is a co-host to invite.

#### 5b: Search for each co-host

For each co-host, use the `substackUsername` field from their record. This is a clean username (no `@` prefix) normalized by the Data Worker reconcile cron when it mirrors Wix into D1:

```
find: "Search input" (in the co-host dialog)
form_input: ref=<search_ref>, value="<substackUsername>"
```

If `substackUsername` is null, fall back to searching by `name`.

Wait 2–3 seconds for Substack to return search results.

#### 5c: Verify and select each co-host

Use `read_page` scoped to the co-host dialog to verify results:

```
read_page: ref_id=<cohost_dialog_ref>
```

The result will show the user's display name, `@handle`, and a checkbox element. **The checkbox is a `<button type="button">` element, NOT a standard `<input type="checkbox">`**. This means:

- `form_input` CANNOT toggle it (it only works on standard form inputs)
- `left_click` with the checkbox ref is needed
- If `left_click` is blocked, ask the user to click the checkbox

After selection, the bottom button should change from "Generate stream key" to "Invite {N} co-host(s) and generate stream key".

Clear the search field before the next co-host (if any).

If no results appear, try alternative search terms (full name). If still no results after 2 attempts, skip this person and note the failure.

#### 5d: Confirm and generate stream key

After all co-hosts are selected, verify the button text via `read_page`:

```
read_page: ref_id=<cohost_dialog_ref>
→ Look for button with text "Invite N co-host(s) and generate stream key"
```

Click the button. If `left_click` is blocked, ask the user to click it. Wait 3–5 seconds for Substack to generate the stream credentials.

### Step 6: Capture stream credentials

After the stream key is generated, the co-host dialog transforms into a confirmation screen. Use `read_page` to capture the credentials — this is the **most reliable method** and does not depend on screenshots or JS:

```
read_page: ref_id=<cohost_dialog_ref>
```

The dialog will contain:

- A heading confirming the show is scheduled (e.g., `"Show Title" is scheduled`)
- **Link to stream** — a textbox with the public stream URL (e.g., `https://open.substack.com/live-stream/NNNNN`)
- **Server URL** — a textbox with the RTMP URL (e.g., `rtmp://global-live.mux.com:5222/app`)
- **Stream key** — a textbox with a UUID (e.g., `463bd00f-480a-7c4c-2063-ae6217b27e6c`)

Identify each value by its label (`generic` elements with text "Link to stream", "Server URL", "Stream key") and the adjacent `textbox` element's value.

Store the **Link to stream** as `substackLivestreamUrl` and the **Stream key** as `restreamKey` for the JSON update.

### Step 7: Capture cohost invite links

After stream credentials are confirmed, construct the cohost invite URL for this show and scrape each cohost's unique invite link from the Substack publisher dashboard.

#### 7a: Construct the cohost invite URL

Build the URL programmatically using the template from `URL_POSTFIX.yml` (`cohost-invite-links`):

```
Template: {SUBSTACK_BASE_URL}/publish/home?action=setup-live-stream&stream_id={STREAM_ID}
```

Extract the two values from existing show fields:

```javascript
// STREAM_ID — numeric suffix of the substackLivestreamUrl
// e.g. "https://open.substack.com/live-stream/162076" → "162076"
const streamId = show.substackLivestreamUrl.split("/live-stream/")[1];

// SUBSTACK_BASE_URL — origin of the substackLiveUrl
// e.g. "https://sickofthis.substack.com/publish/home?..." → "https://sickofthis.substack.com"
const substackBaseUrl = new URL(show.substackLiveUrl).origin;

const cohostInviteUrl = `${substackBaseUrl}/publish/home?action=setup-live-stream&stream_id=${streamId}`;
```

If `javascript_tool` is available, run this snippet directly and capture `cohostInviteUrl`. Otherwise derive both values manually from the strings above.

**Verification:** The constructed URL should match the pattern in the example:

```
https://sickofthis.substack.com/publish/home?action=setup-live-stream&stream_id=162076
```

#### 7b: Fetch invite data from the Substack API

Use `javascript_tool` to call the invites endpoint directly — this is more reliable than DOM scraping because the "Copy invite link" UI element is a `<div>` with a click handler, not an `<a>` tag, so there is no `href` to read from the page.

```javascript
// Called from any sickofthis.substack.com or bannerandbackbone.substack.com page
window.__cohostInvites = null;
fetch(`/api/v1/live_stream/${streamId}/invites`)
  .then((r) => r.json())
  .then((data) => {
    window.__cohostInvites = data;
  });
```

Wait 2 seconds, then read the result:

```javascript
JSON.stringify(
  window.__cohostInvites.invites.map((inv) => ({
    name: inv.invitedUser?.name,
    handle: inv.invitedUser?.handle,
    status: inv.status, // "pending" | "accepted"
    invite_id: inv.id,
    cohostInviteLink:
      inv.status === "accepted"
        ? null
        : `https://substack.com/?live_stream_invite_id=${inv.id}`,
  })),
);
```

**Invite URL pattern:** `https://substack.com/?live_stream_invite_id={invite.id}`

The `invite.id` comes directly from the API response — it is **not** derived from the `substackLivestreamUrl` or any other field.

#### 7c: Map invite results to cohost records

For each invite returned by the API:

- `status === "pending"` → `cohostInviteLink = "https://substack.com/?live_stream_invite_id={invite.id}"`
- `status === "accepted"` → `cohostInviteLink = null` (already confirmed, no invite needed)

Store the full mapping keyed by `handle` (the Substack username without `@`) for use in Step 8.

#### 7d: Close the invite tab

After the API call completes, close the tab opened in 7a via `tabs_close_mcp`. Retain the invite mapping in memory for the PATCH calls in Step 8b.

If the API call fails (network error or non-200 response), log a warning and **skip ALL junction PATCHes in Step 8b** for this show — do not overwrite stored `cohost_invite_url` values in D1 with `null` just because this run couldn't reach the Substack API. PATCH is partial-update by design, so omitting the field entirely preserves whatever D1 already has. Continue with Step 8a (the show's managed-field PATCH) regardless — the cohost-invite scrape is separable from the show-level write.

### Step 8: Write results back to D1 (via the Gateway)

D1 is the system of record for managed fields. This step has TWO parts — one PATCH for the show's managed columns, then one PATCH per cohost for the invite link junctions. **Both go through the Gateway** at `gateway.broadbanner.com/v1/shows/...`. The Gateway proxies them to the Data Worker and stamps `X-Actor` from the cap-token automatically.

**Workspace scoping** is enforced server-side (the PATCH endpoints take a show id and look up the show in D1; you can't accidentally touch a different publication's data). The local `wix-latest.json` file is NO LONGER written by this skill — D1 is authoritative.

#### 8a: PATCH the show's managed fields

Payload — only the fields that have new values:

```json
{
  "schedule_state": "substack_scheduled",
  "substack_livestream_url": "<Link to stream value>",
  "restream_stream_key": "<Stream key value>"
}
```

```bash
curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg ll "$LIVESTREAM_LINK" \
    --arg sk "$STREAM_KEY" \
    '{schedule_state: "substack_scheduled", substack_livestream_url: $ll, restream_stream_key: $sk}')"
```

On 5xx or network error, retry per the policy in `references/gateway-auth.md` (3 max retries, base 500ms, doubling). The cap-token is reused as-is — there's nothing to re-sign. On 4xx, fail loud — that's a request-shape bug (or an expired token).

Note on field names: D1 uses snake_case (`substack_livestream_url`, `restream_stream_key`); the snapshot endpoint surfaces these as `substackLivestreamUrl` and `restreamKey` for read consumers. Send snake_case on PATCH. (Pre-0016 the column was `livestream_link` / `livestreamLink`; senders MUST use the new name now.)

#### 8b: PATCH cohost invite URLs

For each person in the show's `hosts[]` and `guests[]` arrays (NOT `primaryHost` — primary hosts aren't cohosts and don't get invite links), PATCH their junction row with the captured `cohostInviteLink`.

**Resolve which array each cohost belongs to.** Cohosts in `hosts[]` use the `/v1/shows/<id>/hosts/<contributor_id>` endpoint; cohosts in `guests[]` use `/v1/shows/<id>/guests/<contributor_id>`. The arrays come from the snapshot read in Step 0.

**Match by `substackUsername` ↔ `handle`** (same matching rule as before). Fall back to case-insensitive `name` comparison only if `substackUsername` is null.

**Map invite status to the patched value:**

- API returned the cohost with `status === "pending"` → `cohost_invite_url` = `"https://substack.com/?live_stream_invite_id={invite.id}"`
- API returned the cohost with `status === "accepted"` → `cohost_invite_url` = `null` (they've joined, link no longer meaningful)
- API returned but cohost is NOT in response → **skip this PATCH entirely** — don't overwrite a prior value with null. The endpoint is partial-update, so not sending the field leaves the existing value alone.
- API call failed → **skip ALL invite PATCHes for this show** — never overwrite with null on API failure. (Same preservation rule as the legacy local-file flow.)

**Per-cohost PATCH (the cap-token is reused — no signing needed):**

```bash
# For each cohost where we have a value to write:
CONTRIBUTOR_ID="<host.id or guest.id from the snapshot>"
JUNCTION="hosts"  # or "guests"
INVITE_URL="<computed URL or null>"

# Build payload — `null` is a literal JSON null when accepted is true
if [ "$INVITE_URL" = "null" ]; then
  BODY='{"cohost_invite_url": null}'
else
  BODY=$(jq -n --arg u "$INVITE_URL" '{cohost_invite_url: $u}')
fi

curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}/${JUNCTION}/${CONTRIBUTOR_ID}" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

If a junction PATCH returns 404 (`not_found`), the cohort isn't joined to the show at the D1 level — likely a contributor that was added to Wix's `hosts[]`/`guests[]` array but the reconcile cron hasn't picked it up yet. Skip with a warning and move on; the next reconcile cycle will create the junction row, and a re-run will then succeed.

#### 8c: No local file write

This skill does not touch `BroadBanner/Social-Distribution/wix-latest.json`. D1 is the source of truth, served via the Gateway snapshot endpoint (`GET /v1/shows`); the legacy local `wix-latest.json` file and the `banner-admin wix-poller` that wrote it are deprecated and may be absent or stale. Skill writes flow through the Gateway PATCH endpoints exclusively. Do NOT add any local-file mutation here.

### Step 9: Close the browser tab

After PATCH-ing D1, close the tab used for this show via `tabs_close_mcp`:

```
tabs_close_mcp: tabId=<current_tab_id>
```

This prevents stale tabs from accumulating — each show opens a fresh tab (Step 3) and closes it here. If `tabs_close_mcp` fails, log a warning but do not block the workflow.

### Step 10: Process remaining shows

If there are additional shows with `hasLiveScheduled === "title_customized"`:

1. Check if the next show uses a **different `substackLiveUrl`** (different publication). If so, the user may need to switch Substack accounts. Alert the user and wait for confirmation before proceeding.

2. Create a **new tab** and navigate to the next show's `substackLiveUrl`. Do not reuse tabs — the modal state may not reset cleanly.

3. Process shows one at a time. After each show, confirm the PATCHes succeeded (Steps 8a/8b each returned `ok: true`) and the tab is closed before moving to the next.

### Step 11: Final report

After all shows are processed, present a summary:

```
Substack live streams scheduled (D1 PATCH confirmed via Gateway) — times shown in {MACHINE_TZ_ABBR}:

1. {showTitle} — {LOCAL_DATE} at {LOCAL_TIME} {MACHINE_TZ_ABBR}
   {if localTimeZone differs from machine TZ:
     Show-stored: {scheduledStartLocal} ({localTimeZone})
   }
   Stream link: {substackLivestreamUrl}
   Stream key: {restreamKey}
   schedule_state: substack_scheduled
   Co-host invites PATCHed:
     - {name}: {cohostInviteLink | "already accepted (null)" | "skipped — not in API response"}
     - ...

All shows updated in D1 via PATCH /v1/shows/:id (Gateway → Data Worker).
The snapshot cache will pick up the changes within 5 minutes (or immediately
for the next consumer that bypasses the cache).
```

If any shows were skipped (already scheduled per pre-check), list them separately:

```
Skipped (already scheduled on Substack):

1. {showTitle} — found existing scheduled live with matching title
   PATCH /v1/shows/{id} {"schedule_state":"substack_scheduled"} → ok:true
```

If any shows failed, list them separately with the failure reason — distinguishing between
browser-automation failures (e.g. modal didn't open) and PATCH failures (e.g. 5xx after retry).

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
- **Invites API returns non-200 or fails:** Log a warning, **skip ALL invite junction PATCHes for this show** (do NOT overwrite stored values with null on API failure), and continue. The user can retrieve invite links manually from the Substack dashboard at `{substackBaseUrl}/publish/home?action=setup-live-stream&stream_id={streamId}` — the "Co-host status" section in that modal displays each cohost's invite status and a "Copy invite link" button.
- **Cohost already accepted (`status === "accepted"`):** PATCH `cohost_invite_url: null` for that junction — they're confirmed and no invite link is needed.
- **Cohost in show but not found in invites API response:** Skip the PATCH for this cohost entirely. PATCH is partial-update, so omitting the field preserves any prior value in D1.
- **`substackUsername` is null on a cohost:** Fall back to case-insensitive name matching against `invitedUser.name` from the API. If still no match, skip the PATCH for this cohost.
- **Multiple shows on same publication:** Process sequentially. Create a new tab for each show — the URL triggers a fresh modal each time.
- **PATCH /v1/shows/:id returns 5xx or network error:** Retry with exponential backoff per `references/gateway-auth.md` (3 max retries; 500 ms → 1 s → 2 s). The cap-token is reused as-is — no re-signing needed. After retries exhaust, report the failure for this show and continue to the next show — don't abort the whole run.
- **PATCH /v1/shows/:id returns 401 (`unauthorized`):** The cap-token is missing, malformed, or expired. Stop the run and tell the user to re-run `banner-blast init <project-id> --update` (or mint a fresh token via `banner-admin tokens issue`). Do NOT fall back to HMAC against `data.broadbanner.com`.
- **PATCH /v1/shows/:id returns 403 (`forbidden — missing capability: shows:write`):** The workspace token doesn't carry `shows:write`. This skill is admin-tier; the user's D1 contributor row needs `is_admin = 1`. Stop and report.
- **PATCH /v1/shows/:id returns other 4xx (`not_found`, `invalid_field`):** Fail loud for this show with the response body. Do NOT retry — 4xx indicates a request-shape bug or a missing show in D1, neither of which retry can fix. Continue to the next show.
- **PATCH /v1/shows/:id/{hosts,guests}/:contributor_id returns 404 (`not_found`):** The junction row doesn't exist in D1 yet — likely a contributor that was just added to Wix and the reconcile cron hasn't picked it up. Log a warning, skip this cohost's invite PATCH, and continue. The next reconcile cycle will create the junction; a re-run of this skill will then succeed.
- **Gateway 502 (`bad_gateway`) or any persistent gateway-side failure:** The Data Worker is unreachable from the Gateway. Stop the run, tell the user, and **do NOT fall back to direct `data.broadbanner.com` HMAC** — that bypass path is intentionally not in this skill any longer.

## Key technical notes

- **Do NOT resize the window to 1200×900.** The user has set a narrower window (~650×900) that keeps the entire modal visible without internal scrolling. Do not override their window size.
- **The `substackLiveUrl` includes `?action=setup-live-stream`** which should auto-open the scheduling modal on page load.
- **Date/time input is `type="datetime-local"`** — set it via `form_input` with ISO format `YYYY-MM-DDTHH:MM`. Do NOT use the calendar picker or formatted date strings. The value MUST be in the **browser's timezone** (`BROWSER_TZ`, resolved per the "Timezone handling" recipe) — compute it from `scheduledStart` by passing the zone explicitly to `Intl.DateTimeFormat`, never via the shell's ambient `TZ`/`getHours()` (the sandbox shell is often UTC). Never feed `scheduledStartLocal` directly; it's in the show's stored TZ.
- **Set the date/time LAST** in the modal to avoid extension interference after the datetime-local input is modified.
- **The primary host comes from `show.primaryHost`** — resolved from Import2's `primaryHostName` reference via ContributorProfiles → Affiliates name matching. Select them in the "The person going live is..." `<select>` dropdown. They are already excluded from the `hosts` array by the poller.
- **The `substackUsername` field** is pre-extracted and normalized by the Data Worker reconcile cron (no `@` prefix, no whitespace) when it mirrors Wix into D1, and is served by the snapshot endpoint. Use it directly for co-host search.
- **Co-hosts must have Substack accounts with the app installed.** If a co-host doesn't appear in search results, they may not have installed the Substack app — note this in the failure report.
- **Process shows grouped by publication** to minimize account-switching. Sort ready shows by `substackLiveUrl` before processing.
- **The "Invite co-hosts" toggle changes the main button** from "Generate stream key" / "Schedule stream" to "Continue".
- **Substack renders TWO dialog elements.** The first contains the main modal, the second contains the co-host / credentials modal. Always scope `read_page` to the correct dialog ref.
- **Always create a new tab** for each show. Do not reuse tabs — modal state and extension interference can carry over.
