# Repairing an already-Scheduled Restream event

A Restream event that is already **Scheduled** can stop matching its show. This
happens when the show changes after the event was scheduled:

| What changed in BroadBanner | What the Restream-Worker does (within seconds, via the event trigger) | What the Scheduled event is left with |
| --- | --- | --- |
| **Stream key** (re-scheduled on Substack, new key) | Replaces the channel: creates a new `"{showTitle} - {showDate}"` channel with the new key and deletes the old one | No Substack channel paired (the old one is gone) |
| **Date** (moved to another day) | Creates a channel for the new date; deletes the old-date channel (same key, superseded) | Wrong date/time **and** no Substack channel |
| **Title** (renamed) | Creates a channel under the new name; deletes the old-name channel | Old title **and** no Substack channel |
| **Time only** (same day) | Nothing (the channel name has no time) | Wrong start time |
| Channel was **missing when the event was scheduled** | Creates it once the key is present | No Substack channel paired |

Each row except "time only" leaves a D1 signal: the Worker stamps
`restream_events.channel_created_at` **only** when it creates or replaces a
channel, and this skill stamps `scheduled_at` when it schedules or repairs. So:

> **`channel_created_at > scheduled_at` ⇒ the channel changed after the event was
> scheduled ⇒ re-pair.** A time-only change is caught by comparing the event
> row's visible date/time with the expected one (Step R1).

This is a **repair signal only**. It never gates normal scheduling, and the
visible badge is still the only authority on an event's status (see SKILL.md
Step 2).

## Step R0 — Build the repair candidate list (in Step 0)

For each `restream_scheduled` show inside the horizon whose `scheduledStart`
is still in the future, find its D1 row with `list_restream_events({ workspace })`
(one call per workspace, shared with the courtesy log). Mark the show:

- `needsRepair: "channel"` when the row has `channel_created_at` and
  `scheduled_at` and `channel_created_at > scheduled_at`, or when the row's
  `channel_id` is null.
- otherwise `needsRepair: "check"`. Step R1 compares the visible date/time,
  which costs nothing extra.

Never repair a show whose `scheduledStart` has passed, or whose event is Live.

## Step R1 — Visible date/time check (in Step 2, on the event row)

When Step 2 lands on a **Scheduled** row for a repair candidate, `read_page` the
row's displayed start date/time and compare it to `LOCAL_DATE` /
`LOCAL_TIME_12H` (SKILL.md "Timezone handling"). A mismatch of a minute or
more sets `needsRepair: "reschedule"`. If the row shows no date/time, open the
⋮ menu's scheduling entry read-only, read the Date/Time fields, and Cancel.

- `"check"` with a matching date/time → nothing to do. Report "verified".
- `"channel"` → Step R2.
- `"reschedule"` → Step R3. It covers the channel too.

## Step R2 — Re-pair the Substack channel (schedule unchanged)

1. ⋮ on the event row → **Pair channels**. Don't use "Schedule"; that reopens
   the date flow.
2. In the channel list, find `"{showTitle} - {showDate}"`. Match by prefix or
   containment because the UI truncates. Toggle it **ON**, as in SKILL.md Step 5b.
3. If another channel for **this same show** is still ON (an old title or old
   date for the same series and episode that the Worker hasn't reaped yet),
   toggle it **OFF**. Two Substack channels on one event stream the same key
   twice. Never touch channels for other platforms (YouTube, Twitch, and so on).
4. Save or confirm. Use `read_page` to verify the expected channel is active and
   the badge still reads **Scheduled**.
5. If the expected channel doesn't exist yet, leave the event unchanged. Add
   the show to the channel-pending list (SKILL.md Step 5a). The retry repairs it.

## Step R3 — Reschedule (date/time changed)

1. ⋮ on the event row → the scheduling entry the menu offers for a Scheduled
   event. This is usually **Schedule**; some UIs label it **Reschedule** or
   **Edit event**. `find` it; if none exists, report "reschedule needed —
   no menu entry" and stop for this show.
2. Fill the modal exactly like SKILL.md Steps 4a–4d: title = current
   `showTitle`, description, `LOCAL_DATE` / `LOCAL_TIME`, and the TZ-label check.
3. In the channel step, apply Step R2 items 2–3: the new channel ON, and any
   stale channel for this show OFF.
4. Confirm, then verify the row shows the new date/time and **Scheduled**.

## Step R4 — Record the repair

On success, call `upsert_restream_event` as in SKILL.md Step 6, with the same
`event_id` (from the D1 row or the page), `event_status: "scheduled"`, and
`scheduled_at: new Date().toISOString()`. The fresh `scheduled_at` clears the
`channel_created_at > scheduled_at` signal, so the next run doesn't repair it
again.

## Report

List repairs separately in the final report:

```
Repaired scheduled events:
  - {showTitle} — re-paired channel "{channel}" (stream key changed)
  - {showTitle} — rescheduled to {LOCAL_DATE} {LOCAL_TIME_12H} {TZ}, channel re-paired
Verified (no change): {N}
```
