---
name: drain-clip-queue
description: >
  Drain the next due Substack video-note from the Social-Distribution queue.
  Use this skill when invoked by the recurring "drain-clip-queue" scheduled
  task, or any time the user says "drain the clip queue", "post the next
  clip", "release a queued clip", or "check for due clips". Scans for
  restream-clip trackers whose substack status is pending and whose
  release_at has passed, picks the single oldest-due record, and invokes the
  substack-video-note skill to post it. If nothing is due, it exits
  immediately — this is the common case and must stay cheap.
---

# Drain Clip Queue

Minimum-cost dispatcher that wakes on a schedule, checks whether any Substack
video-note is due, and processes **at most one** per invocation.

Substack video-notes post by fetching the clip from R2 directly inside the
composer and injecting it (see `substack-video-note/SKILL.md`). This requires
the media endpoint to send `Access-Control-Allow-Origin` for `substack.com`
— if that CORS header is not yet configured, `substack-video-note` marks the
record `failed` with `error: "media CORS not configured"` and this dispatcher
moves on.

## Contract

- **Scope:** Substack only. Bluesky and Threads are drained by the BannerBlast
  Distribution Worker (`api.broadbanner.com`) queue consumer, which honors
  `release_at` natively via scheduled queue messages — do not touch those
  platform entries.
- **Local-only — no network.** This skill never calls the Gateway. The queue is
  fed separately by the `refill-clip-queue` skill (its own low-frequency
  scheduled task), which writes the local `*_restream-clip_*.json` pointers this
  skill consumes. Cowork bash has no outbound network, so the networked pull
  lives in that browser-driven skill, not here.
- **Batch size:** exactly one record posted per invocation. Process the
  oldest-due record and exit. (This naturally staggers posts across scheduler
  ticks so the Substack profile is not flooded.)
- **Idempotency:** if nothing is pending/due, exit immediately. Do NOT open a
  browser, do NOT load any other skill, do NOT make tool calls beyond the
  directory scan and one JSON read.

## Step-by-step

### Step 0: Ensure mount

Verify the active brand's host workspace — the mounted project root containing
`broadbanner.config.json` — is mounted. If not, request it. When this skill runs
under the scheduled task there is no human to approve a prompt — if the mount
is unavailable and cannot be requested non-interactively, exit immediately
with a diagnostic and let the operator re-run manually.

The queue this skill drains is filled by the separate `refill-clip-queue` skill.
If the queue is empty, that is normal — either nothing new has been pulled yet,
or the refill task hasn't run. This skill never pulls from the Gateway itself.

### Step 1: Locate the queue directory

The directory is `<Publication>/Social-Distribution/`, resolved against the
active project root. If it does not exist, report
`drain-clip-queue: no queue directory — nothing to do` and exit.

### Step 2: Scan for due records

List files matching `*_restream-clip_*.json`. For each, read and parse the
JSON and check:

1. `source === "restream-clip"` — required.
2. `platforms.substack.status === "pending"` — required. Anything else
   (`queued`, `posted`, `failed`, `skipped`) is a no-op.
3. `platforms.substack.release_at` is present AND `<=` now. If `release_at`
   is missing, treat the record as due (legacy/manual entries).

Collect matching `{ filePath, record }` pairs.

### Step 3: Exit fast if nothing is due

If no records match, print exactly one line:

```
drain-clip-queue: nothing due (<N> pending, <M> waiting on release_at)
```

and stop. No tool calls beyond the scan. This is the common path and the
entire reason this skill exists as a separate dispatcher.

### Step 4: Pick the oldest-due record

Sort matching records by `platforms.substack.release_at` ascending (falling
back to `created_at`). Pick the first one. That is the record to drain.

### Step 5: Mark it queued before delegating

Update the record's `platforms.substack.status` from `"pending"` to
`"queued"` and write the file back. This is a soft lock — if another
drain-clip-queue tick fires while this one is still running, it sees `queued`
and skips this record. Do NOT delete `release_at`.

### Step 6: Invoke the substack-video-note skill

Invoke `substack-video-note` in this same session, passing the tracker file
path. That skill owns the terminal state — it fetches the clip from R2,
injects it into the composer, posts, and sets `platforms.substack` to
`posted` (or `failed`) in-place. This dispatcher does NOT touch
`platforms.substack` again after handing off.

If `substack-video-note` reports a CORS/media failure, do not retry within
this run — exit and let the operator address the endpoint. The record is left
`failed` so it is not re-attempted on the next tick until reset to `pending`.

### Step 7: Report and exit

Print one line summarizing the outcome, e.g.:

```
drain-clip-queue: posted <basename>
```

or

```
drain-clip-queue: <basename> failed — <reason>
```

Then exit. Do not process a second record.

## Error handling

- **Queue dir missing:** one-line report, exit clean.
- **JSON parse failure on a file:** skip that file, log a single warning,
  continue scanning. Never block the queue on one bad record.
- **substack-video-note failure:** leave the record `failed`, exit. The next
  tick picks up the next due record.

## Setup (per contributor, incl. multi-brand hosts)

The queue is filled by the `refill-clip-queue` skill. First-time per-user setup —
`chromeProfiles`, a `posts:read` token, pod enrollment — lives with that skill in
`../refill-clip-queue/references/contributor-setup.md`. The design is
brand-agnostic: a host with shows under several brands gets one queue from a flat
`effectivePodIds` list and needs no special code, only that config.

## Cost notes

Every wakeup of the recurring scheduled task costs one model turn. The Step 3
fast-exit path keeps the nothing-due turn as short as possible: a directory
listing, a handful of small JSON reads, one report line, exit. No network, no
browser, no Chrome MCP load, no other skill invocations on the nothing-due path.
(The networked refill is a separate skill/task — see `refill-clip-queue`.)
