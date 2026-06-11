---
name: refill-clip-queue
description: >
  Refill the local Substack clip queue from the Gateway. Use when invoked by the
  recurring "refill-clip-queue" scheduled task, or when the user says "refill the
  clip queue", "pull my clips", or "fetch new clips". Pulls the pending
  restream-clips for the calling user via an in-browser Gateway call (Cowork
  bash has no network), then writes local pending pointers marked ready-now for
  drain-clip-queue to post on its schedule. Never posts anything itself.
---

# Refill Clip Queue

Populate the local Substack clip queue from the hosted system. This is the
**feed** half of the per-user Substack clip pipeline; `drain-clip-queue` is the
**post** half. Keep them separate: this skill does the (networked) Gateway pull
on a low-frequency schedule; drain stays cheap and local and runs often.

**Why a browser fetch.** The Cowork bash sandbox has **no outbound network**, so
`curl`/`node fetch()` to `gateway.broadbanner.com` fail with "fetch failed". The
only way to reach the Gateway from Cowork is a same-origin `javascript_tool`
fetch in a browser tab pointed at `gateway.broadbanner.com` — the exact pattern
`substack-note` uses for ingest. This skill fetches the clip list that way, then
hands the JSON to a local script for the deterministic queue logic.

## Contract

- **Read-only on the hosted side, write-only locally.** Fetches the clip list;
  writes a few-KB local pointer per new clip (the clip stays single-copy in R2).
- **Never posts.** No Substack composer, no `substack-video-note`. That is
  `drain-clip-queue`'s job on a later tick.
- **One hands-off behavior — no modes, no flags.** The bundled
  `pull-clip-queue.mjs` queues up to `limit` of the newest eligible clips each
  run (eligible = pod-authorized, has media, not already queued, not older than
  `maxAgeDays`), stamps `release_at` staggered ~30 min apart (pure elapsed
  offsets — no wall-clock window, so it is timezone-safe in the UTC sandbox), and
  dedups permanently so nothing posts twice. `drain`'s cron (in your local
  timezone) enforces the actual 9am-9pm posting window and posts one clip per
  ~30-min tick. Config lives in `clipQueue` (`broadbanner.config.json`); defaults
  `limit: 5`, `maxAgeDays: 30`, `spacingMinutes: 30` — all optional.

## Step-by-step

### Step 0: Ensure mount + load identity

Verify the active project root (the mounted folder with `broadbanner.config.json`)
is mounted; if not, `request_cowork_directory` for it. Under the scheduled task
there is no human to approve a prompt — if it can't be mounted non-interactively,
exit with a diagnostic.

Read these from the project root (bash, not network):

```bash
GATEWAY_TOKEN=$(cat "<PROJECT_ROOT>/.creds/gateway.token")
USER_ID=$(cat "<PROJECT_ROOT>/.creds/userid")
```

If either is missing, report and exit — `banner-blast init` provisions both.

### Step 1: Fetch the pending clips via an in-browser Gateway call

Navigate to `https://gateway.broadbanner.com` in a tab (same-origin requirement
for the fetch), then run a single `javascript_tool` call. Substitute `USER_ID`
and `GATEWAY_TOKEN`:

```javascript
const resp = await fetch(
  "/v1/posts?uuid=<USER_ID>&source=restream-clip&platform=substack&status=pending&limit=200&view=slim",
  { headers: { Authorization: "Bearer <GATEWAY_TOKEN>" } },
);
const data = await resp.json();
JSON.stringify({ status: resp.status, data });
```

**Always pass `&view=slim`.** It returns an allowlist projection — only
`id`, `source`, `created_at`, a slimmed `clip` (`clip_id`, `pod_id`, `title`,
`caption`, `hashtags`, `r2_key`, `episode_slug`), and `platforms.substack`. It
drops the signed Restream/R2 URLs (`download_url`, `thumbnail_url`) and the
transcript, whose tokened query strings/base64 trip the Chrome-MCP exfiltration
filter and would otherwise block `javascript_tool` from returning the JSON. With
`view=slim` the response comes back clean, so you can return it and write it to
the temp file directly (Step 2) — no blob-download / scrub workaround needed.

Interpret the result:

- **200** → `data.trackers` is the pending list. Continue to Step 2.
- **403** (`Missing capability: posts:read`) → the token lacks `posts:read`.
  Report: re-run `banner-blast init` to re-issue the token (the creator/
  contributor/admin presets include `posts:read` as of `@broadbanner/core`
  v1.29.0; install the latest `banner-blast` first). Exit — do not write anything.
- **401** → token expired/invalid. Report: re-run `banner-blast init`. Exit.
- **5xx** → retry up to 3× (0.5s → 1s → 2s). If still failing, report the
  Gateway is down and exit; the next scheduled run retries.

### Step 2: Hand the list to the local queue script

Write the fetched payload to a temp file, then run the bundled script — it owns
the deterministic logic (limiter, dedup, recency, ready-now pointer writes):

```bash
echo '<the JSON string from data, i.e. {"trackers":[...]}>' > /tmp/refill-clips.json
node "<SKILL_DIR>/scripts/pull-clip-queue.mjs" --project "<PROJECT_ROOT>" --fixture /tmp/refill-clips.json
```

- `<SKILL_DIR>` is this skill's directory. If it isn't reachable from the bash
  sandbox, copy `scripts/pull-clip-queue.mjs` into the outputs dir and run it
  there — it is zero-dependency Node.
- Write `data` (the object containing `trackers`) verbatim — the script accepts
  either `{ "trackers": [...] }` or a bare array.
- The script prints what it queued (e.g. `queued 5/6 eligible (limit 5)`) or
  `nothing new`. It queues the newest eligible clips up to the limit every run —
  no baseline, no first-run special case — so the pending pool drains a few per
  run and newly-ingested clips flow automatically.

### Step 3: Clean up and report

Close the Gateway tab (`tabs_context_mcp` → `tabs_close_mcp`). Print the script's
one-line summary. Exit. Posting happens on a later `drain-clip-queue` tick.

## Relationship to drain-clip-queue

| Skill | Network? | Frequency | Does |
| --- | --- | --- | --- |
| `refill-clip-queue` (this) | yes (browser fetch) | low (e.g. hourly) | pulls clips → writes local pending pointers |
| `drain-clip-queue` | no | high (e.g. every 30m) | posts one due clip from the local queue |

First-time per-user setup (token with `posts:read`, `chromeProfiles`, pod
enrollment — including multi-brand hosts) is in `references/contributor-setup.md`.
