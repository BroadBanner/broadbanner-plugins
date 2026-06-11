---
name: restream-publish-clip
description: >
  Publish a Restream clip named by a restream-clip tracker to TikTok and
  YouTube (plus Facebook for B&B) via the Restream clips UI in Chrome. Use
  when the user says "publish the next clip on Restream", "post the clip to
  TikTok and YouTube", "publish the restream clip", or a restream-clip
  tracker has pending Restream platforms. Also triggers after banner-blast
  push processes a clip tracker that still needs publishing. With multiple
  pending clips, the first publishes immediately and the rest are scheduled
  as staggered one-shot tasks.
---

# Restream Publish Clip

Publish pending clips from `restream-clip` tracker files to TikTok and YouTube
(and Facebook for B&B) using Restream's clips publishing UI. Handles batches:
first clip publishes immediately, subsequent clips get one-shot scheduled tasks
with randomised 10–40 minute delays between them.

## Failure modes this skill defends against

This spec is strict because two earlier failure modes caused real damage:

1. **Tracker/clip misalignment.** A project page in Restream contains every
   clip for an episode. The earlier version of Step 5 said "click the first
   unpublished clip" — which decoupled the clip being published from the
   tracker being mutated. Wrong clip got the credit; the tracker we
   actually wanted to retire stayed `pending`.
2. **Silent write failure on Step 10.** The earlier Step 10 only sketched
   the JSON to merge; it didn't say "use the Edit tool against `<file>`."
   Trackers stayed `pending` after a successful publish, so every later
   skill invocation reclassified them as `due` and republished the clip.
   Same clip went out to TikTok / YouTube multiple times.

The current spec aligns Step 5 with the tracker's specific clip and treats
Step 10 as a verified write. **Do not weaken either.**

## Prerequisites

- User must be logged in to Restream at `app.restream.io` in Chrome.
- `Social-Distribution/` must contain at least one `*_restream-clip_*.json`
  file with no `platforms.restream_publish` entry, or one with
  `status: "pending"` and a `release_at` that is now due.

## Tool reliability guide

| Tool               | Reliability    | Use for                                          |
| ------------------ | -------------- | ------------------------------------------------ |
| `read_page`        | Always works   | Verifying page state, reading element refs       |
| `find`             | Always works   | Locating elements by description                 |
| `form_input`       | Always works   | Text inputs, description fields                  |
| `navigate`         | Always works   | Page navigation                                  |
| `tabs_context_mcp` | Always works   | Tab IDs                                          |
| `left_click`       | Can be blocked | Clicking buttons (ask user to click as fallback) |
| `screenshot`       | Can be blocked | Visual verification (use `read_page` fallback)   |
| `javascript_tool`  | Can be blocked | DOM manipulation (use `form_input` instead)      |

If `left_click` is blocked for a critical step, tell the user exactly what to
click and wait for confirmation before continuing.

---

## Platform account lookup

Choose platform accounts based on `clip.pod_id`:

| pod_id prefix | TikTok            | YouTube           | Facebook                |
| ------------- | ----------------- | ----------------- | ----------------------- |
| `sotsp-*`     | Nick Paro         | Sick of this Show | _(not toggled)_         |
| `babm-*`      | Banner & Backbone | Banner & Backbone | Banner & Backbone Media |
| `lr-*`        | _(all available)_ | _(all available)_ | _(all available)_       |

For `lr-*` (Lev Remembers brand: `lr-vfu` Voice from Ukraine, `lr-lr` Lev
Remembers), the policy is **post to every available account on every
platform** — TikTok, YouTube, and Facebook alike. If multiple accounts are
listed under any platform in the publish modal, toggle ALL of them on. Do
not pick a subset. The policy is identical for both shows.

If an unrecognised prefix appears (anything other than `sotsp-*`, `babm-*`,
or `lr-*`), pause and ask the user which accounts to toggle before
proceeding.

---

## Step-by-step workflow

### Step 0: Ensure BroadBanner mount

Verify `~/BroadBanner` is mounted at `/sessions/*/mnt/BroadBanner`. If not,
call `mcp__cowork__request_cowork_directory` with `path: "~/BroadBanner"`.

Also load `broadbanner.config.json` from the brand workspace root (alongside
`Social-Distribution/`). Capture the `chromeProfiles` block (if present) — you'll
need it in Step 3.5 to pick the correct browser profile for the chosen clip.
If the block is absent, profile-routing is disabled and the skill will use
the currently-selected browser.

---

### Step 1: Classify all pending clips

Scan `Social-Distribution/` for files matching `*_restream-clip_*.json`.
Parse each and sort by filename ascending (oldest first). Classify every file:

| Class           | Condition                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| **unscheduled** | `platforms.restream_publish` is absent entirely                                                       |
| **due**         | `platforms.restream_publish.status === "pending"` AND `release_at <= now` (or `release_at` is absent) |
| **waiting**     | `platforms.restream_publish.status === "pending"` AND `release_at > now`                              |
| **done**        | `status` is `"posted"`, `"skipped"`, or `"failed"`                                                    |

Build two lists:

- `unscheduled_clips` — need scheduling right now
- `due_clips` — already scheduled and their time has come

**Fast-exit cases:**

- Both lists empty → report `restream-publish-clip: nothing to do` and exit.
- `unscheduled_clips` is empty but `due_clips` is also empty (only `waiting`) →
  report `restream-publish-clip: N clips waiting, next due at <earliest release_at>` and exit.

---

### Step 2: Assign release times and schedule future clips

Only run this step if `unscheduled_clips` is non-empty.

**Compute staggered release times within the 10am–11pm ET window:**

```
now_et       = current time in US/Eastern
window_open  = today 10:00 ET
window_close = today 23:00 ET
cumulative_offset = 0

for i, clip in enumerate(unscheduled_clips):
    if i == 0:
        candidate = now_et
    else:
        delay = random integer in [30, 90] (minutes)
        cumulative_offset += delay
        candidate = now_et + cumulative_offset minutes

    # Clamp to window: push early times to window open, late times to next day
    if candidate < window_open:
        candidate = window_open
    elif candidate >= window_close:
        candidate = window_open + 24 hours   # next day 10:00 ET

    release_at[clip] = candidate (converted to UTC ISO 8601)
```

**Write release_at to each unscheduled tracker:**

```json
{
  "platforms": {
    "restream_publish": {
      "status": "pending",
      "release_at": "<ISO 8601 UTC>"
    }
  }
}
```

Merge into the existing `platforms` block — do not overwrite other entries.

**Create one-shot scheduled tasks for clips 2 and beyond:**

For each clip at index ≥ 1 in `unscheduled_clips`, call
`mcp__scheduled-tasks__create_scheduled_task` with:

```
taskId:      "restream-clip-<first 8 chars of clip.clip_id>"
description: "Publish Restream clip: <clip.title> (<clip.event_title>)"
fireAt:      "<release_at[clip]> as ISO 8601 with local timezone offset>"
prompt:      """
Run the restream-publish-clip skill.

Find the next pending restream-clip tracker in Social-Distribution/ whose
platforms.restream_publish.release_at is now due (release_at <= current time),
and publish that clip to Restream's TikTok and YouTube platforms via
app.restream.io/clips. Process exactly one clip then exit.

Target clip context (for disambiguation if multiple are due simultaneously):
  clip_id:     <clip.clip_id>
  clip_title:  <clip.title>
  project_id:  <clip.project_id>
  pod_id:      <clip.pod_id>
"""
notifyOnCompletion: false
```

After creating tasks, move the first unscheduled clip into `due_clips` (its
release_at is now, so it is immediately due). The remaining clips are now
`waiting` and will be handled by their scheduled tasks.

Report the schedule to the user:

```
restream-publish-clip: found N clips — publishing now + scheduling N-1 tasks
  Clip 1 (now):       "<clip_title>"
  Clip 2 (10:45 ET):  "<clip_title>"
  Clip 3 (12:15 ET):  "<clip_title>"
  ...
```

Include the ET wall-clock time for each scheduled clip so the user can see exactly when they'll drop.

---

### Step 3: Pick the clip to process now

From `due_clips`, pick the oldest by `release_at` (or `created_at` as
fallback). This is the clip to publish in this invocation.

Extract — and **hold on to all of these for Step 5 and Step 10**, you
will need them:

| Variable       | JSON path                | Example                                                                        |
| -------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `tracker_path` | (the absolute file path) | `/Users/.../Social-Distribution/20260407-131341_restream-clip_c127ace8-….json` |
| `project_id`   | `clip.project_id`        | `"510dac4d-b1ae-4204-ae8b-4661541144b0"`                                       |
| `clip_title`   | `clip.title`             | `"Activate apathetic voters not extremists"`                                   |
| `pod_id`       | `clip.pod_id`            | `"sotsp-notw"`                                                                 |
| `clip_id`      | `clip.clip_id`           | `"c127ace8-..."`                                                               |

`tracker_path` is the single most important variable in this skill.
Every Step 10 write targets that exact path. If you lose it, you cannot
reliably write back, and the skill will repost on its next run.

Derive platform accounts from the lookup table above.

**Compute YouTube title and description:**

```
original_title    = clip_title
youtube_title     = clip_title
youtube_description = ""

if len(original_title) > 100:
    # Scan for first sentence-ending punctuation followed by a space
    split_pos = first index where original_title[i] in {'.', '?', '!'}
                AND (original_title[i+1] == ' ' OR i == last index)
    if split_pos found:
        youtube_title       = original_title[:split_pos + 1].strip()
        youtube_description = original_title[split_pos + 2:].strip()
    else:
        youtube_title       = original_title[:97].rstrip() + "..."
        youtube_description = ""
```

---

### Step 3.5: Select the correct Chrome profile

Before any browser action, switch to the Claude-in-Chrome profile that owns
the Restream account for this clip's pod. See `references/chrome-profile-routing.md`
for the full algorithm.

Quick version:

1. Look up `chromeProfiles.bySeriesId[pod_id]` from the config loaded in Step 0.
2. Else look up `chromeProfiles.byBrand[<brand for pod_id>]` (resolve brand
   via the brand prefix on `pod_id`, or via `BroadBanner-Core` pod-map if available).
3. Else: skip the switch.

If a target profile resolved:

```
list_connected_browsers → find entry where name === <target profile>
select_browser({ deviceId: <matching deviceId> })
```

Skip `select_browser` if the current browser is already that profile. If no
connected browser matches the resolved name, **stop and tell the user** —
publishing on the wrong account posts under the wrong identity. Suggest pairing
the missing profile via `switch_browser`.

This skill processes one clip per invocation, so the resolution happens once
per run (between picking the clip in Step 3 and navigating in Step 4).

---

### Step 4: Navigate directly to the clip project

Navigate directly to the project URL using `project_id` from the tracker:

```
https://app.restream.io/clips/<project_id>
```

Confirm the project view has loaded via `read_page` — it should show a list
of clips for this episode. If the page shows an error or redirects to the
clips index, the `project_id` may be stale; ask the user to verify before
continuing.

---

### Step 5: Locate THIS tracker's clip in the project

> **Critical.** This step replaces the old "find the first unpublished clip"
> behaviour. Do not pick clips by position in the list. Always match the
> tracker's `clip_title` (extracted in Step 3). Decoupling clip selection
> from the tracker is what caused the silent multi-post bug — see
> _Failure modes this skill defends against_ at the top of this file.

Use `read_page` to list every clip in the project view with its title and
published state.

Match the tracker's `clip_title` against the clip list using these rules,
in order. Use the first rule that produces a unique match:

1. Exact `clip_title` match.
2. Case-insensitive `clip_title` match.
3. Substring match (UI text contains `clip_title`, or vice versa) — **only
   if exactly one clip matches**. If multiple substring matches, do NOT
   guess — stop and ask the user which clip is correct.

Branches:

| Result                                           | Action                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Found, already shows "Published" / "✓ Published" | Skip Steps 7–9. Go directly to Step 10 with the **skipped** payload (`skipped_reason: "already-published-in-ui"`).                    |
| Found, not yet published                         | Click **THAT clip's** `Publish` button — not any other clip's. Continue to Step 7.                                                    |
| Not found at all                                 | Skip Steps 7–9. Go to Step 10 with the **failed** payload (`error: "clip title \"<clip_title>\" not found in project <project_id>"`). |
| Multiple ambiguous substring matches             | Stop, ask the user, do NOT proceed.                                                                                                   |

Confirm the publish modal that opens corresponds to the matched clip
(use `read_page` to verify the modal title or context shows
`clip_title`). If the modal opened on the wrong clip, close it and stop —
do not publish.

---

### Step 7: Configure platform toggles

The publish modal lists connected platform accounts with toggles.

Enable ONLY the accounts from the lookup table; disable any others that may
be pre-enabled by default. Use `read_page` to check current toggle state
before clicking — only change toggles that need to change.

**sotsp-\*:** TikTok → Nick Paro, YouTube → Sick of this Show  
**babm-\*:** TikTok → Banner & Backbone, YouTube → Banner & Backbone, Facebook → Banner & Backbone Media  
**lr-\*:** Toggle ON every available account across TikTok, YouTube, and Facebook — if multiple accounts are listed under a platform, enable all of them. No subset selection.

---

### Step 8: Set YouTube title and description

Locate the YouTube title input (via `find` or `read_page`). Set it to
`youtube_title` using `form_input`.

If `youtube_description` is non-empty, locate the YouTube description field
and set it to `youtube_description`.

Skip this step entirely if `clip_title` was ≤ 100 chars.

---

### Step 9: Publish

Click **Publish Clips**. Wait for a success confirmation (toast, status badge,
or modal close) using `read_page`.

If the UI returns an error, capture the message. Do not mark the tracker as
`"posted"` on failure.

---

### Step 10: Update the tracker (verified write)

> **Critical.** Read this whole section before acting. This is the step
> that makes the skill idempotent. If the write doesn't land, the next
> invocation will reclassify the clip as `due` and republish it. A
> tracker stuck at `pending` past its `release_at` is the smoking-gun
> signal that this step failed silently.

#### File path

The destination is `tracker_path` from Step 3. Track it explicitly. Do
not reconstruct it from the tracker `id` or from the clip filename
template — use the path you discovered when classifying in Step 1.

#### Tool

Use the `Edit` tool against `tracker_path` (or the `Write` tool if you
are rewriting the entire file). **Including the JSON snippet in the
chat / report is NOT a write.** The skill must produce a file mutation.

#### Merge semantics

Preserve every existing key under `platforms` (substack, bluesky,
threads, anything else). Only the `restream_publish` key may be
mutated. Do not mutate `clip`, `id`, `created_at`, `source`, or any
other top-level field.

#### Payloads (pick exactly one, based on what happened)

**A. Step 9 publish succeeded — `posted`:**

```json
{
  "platforms": {
    "restream_publish": {
      "status": "posted",
      "posted_at": "<ISO 8601 UTC, current time>",
      "accounts": ["tiktok:<account>", "youtube:<account>"]
    }
  }
}
```

Add `"facebook:<account>"` to `accounts` for `babm-*`. For `lr-*`, list every
account toggled on in the publish modal under `accounts` (every TikTok,
YouTube, and Facebook entry that was available — there is no fixed set).

**B. Step 5 found the clip already showing "Published" — `skipped`:**

```json
{
  "platforms": {
    "restream_publish": {
      "status": "skipped",
      "skipped_reason": "already-published-in-ui"
    }
  }
}
```

**C. Step 5 could not locate the tracker's clip in the project — `failed`:**

```json
{
  "platforms": {
    "restream_publish": {
      "status": "failed",
      "error": "clip title \"<clip_title>\" not found in project <project_id>"
    }
  }
}
```

**D. Step 9 returned an error from the publish modal — `failed`:**

```json
{
  "platforms": {
    "restream_publish": {
      "status": "failed",
      "error": "<UI error message — first 200 chars>"
    }
  }
}
```

#### Verify the write — required, not optional

Immediately after the Edit/Write call, **Read `tracker_path` again** and
assert all of:

1. `platforms.restream_publish.status` equals the value you just wrote
   (`posted` / `skipped` / `failed`).
2. The other entries (`substack`, `bluesky`, `threads`, etc.) are still
   present and unchanged from before the write.
3. The top-level fields (`id`, `source`, `created_at`, `clip`) are
   still present and unchanged.

If any assertion fails, the write did NOT persist correctly. Capture
the actual read-back value and surface it in Step 12 as a CRITICAL
FAILURE — do not report success, do not close tabs, stop and tell the
user. A silent write failure is the bug we are explicitly defending
against; we will not ship it twice.

---

### Step 11: Clean up browser

Close all tabs opened during this run. Call `tabs_context_mcp` to get the full tab list, then `tabs_close_mcp` for each tab ID opened by this skill. If `tabs_close_mcp` fails for any tab, log a warning but do not block the report.

### Step 12: Report

The report MUST include the `verified=…` line on the second row,
echoing the status you just read back from disk in Step 10's
verification. This is what tells the human (and any reviewing agent)
that the tracker actually changed state. Never report success without
the verified line.

**Success (Step 10 payload A — `posted`):**

```
restream-publish-clip: posted "<clip_title>" → TikTok (<account>), YouTube (<account>) [<tracker filename>]
  verified: status=posted in <tracker filename>
```

**Skipped (Step 10 payload B — `already-published-in-ui`):**

```
restream-publish-clip: skipped "<clip_title>" — already published in UI [<tracker filename>]
  verified: status=skipped in <tracker filename>
```

**Failure — clip not found (Step 10 payload C):**

```
restream-publish-clip: FAILED "<clip_title>" — clip not found in project <project_id> [<tracker filename>]
  verified: status=failed in <tracker filename>
```

**Failure — publish error (Step 10 payload D):**

```
restream-publish-clip: FAILED "<clip_title>" — <error> [<tracker filename>]
  verified: status=failed in <tracker filename>
```

**CRITICAL — write did not persist:**

If the Step 10 read-back verification did NOT match what you wrote,
report this and stop. Do NOT close tabs (Step 11 is skipped). The
human needs to see exactly what's on disk so they can recover.

```
restream-publish-clip: CRITICAL — clip published in Restream UI but
tracker write did not persist.
  expected: status=<intended status> in <tracker filename>
  actual:   status=<status currently on disk>
  next:     do NOT re-run this skill against this tracker until the
            write is investigated. Each rerun will republish the clip.
```

---

## Error handling

| Situation                     | Action                                                                |
| ----------------------------- | --------------------------------------------------------------------- |
| No pending or due clips       | One-line report, exit clean                                           |
| Only waiting clips            | Report next due time, exit clean                                      |
| Project URL 404s or redirects | `project_id` may be stale — ask user to verify before continuing      |
| All clips already published   | Mark tracker `skipped`, exit                                          |
| Unrecognised pod_id prefix    | Ask user which accounts to toggle                                     |
| Toggle click blocked          | Ask user to enable manually, then confirm                             |
| Publish returns error         | Mark tracker `failed`, report                                         |
| Scheduled task creation fails | Warn user — the clip will need manual re-invocation at the right time |
