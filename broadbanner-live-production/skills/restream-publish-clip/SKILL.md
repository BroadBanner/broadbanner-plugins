---
name: restream-publish-clip
description: >
  Publish your next Restream clip to TikTok and YouTube (plus Facebook for B&B)
  from Restream's clips UI, in the browser that holds the clip's Restream
  account. Use when the user says "publish the next clip on Restream", "post the
  clip to TikTok and YouTube", "publish the restream clip", or the hourly
  clip-publishing task runs. Reads the clips waiting from the BroadBanner
  connector (only clips made after the start date; never a series with
  auto-posting off), publishes ONE per run, and records the result.
metadata:
  requiresTool: banner_blast
---

# Restream Publish Clip

Publish one pending Restream clip per run to TikTok and YouTube (and Facebook
for B&B) using Restream's clips publishing UI. The list of clips comes from the
**BroadBanner connector**, and the result goes back to it. There are no local
tracker files any more.

## What keeps this safe

- **No backfill.** BannerBlast gives a clip a Restream publishing slot only when
  Restream made the clip after the feature's start date. Older clips never show
  up in `list_pending_restream_clips`.
- **Held series are skipped.** A series whose auto-posting is set to Manual holds
  every platform of its clips, this one included, so they never show up.
- **One copy per clip.** Only the Restream account owner's copy carries the slot,
  so a co-host's run never publishes the same clip again.
- **One clip per run, spaced out.** Each run publishes at most **one** clip, the
  oldest. The scheduled task runs once an hour between 10:00 and 22:00 ET, so
  clips go out at least an hour apart and a backlog drains over the day.
- **The right clip, marked once.** Step 5 matches the clip by title, never by
  position. Step 9 records the result right after publishing, and a clip can be
  recorded only once (a second mark answers `not_pending`).

Two earlier bugs shaped this: publishing "the first unpublished clip" in a
project gave the wrong clip the credit, and a result that never got written made
every later run publish the same clip again. **Do not weaken Step 5 or Step 9.**

## Step 0: Preflight (no tool call)

The connector registers `list_pending_restream_clips` and
`mark_restream_published` only for accounts with BannerBlast (`creators:write`).
If they are missing: attended, say the connector needs to be connected with a
plan that includes BannerBlast and stop; unattended, report
`restream-publish-clip: skipped (connector tools unavailable)` and stop. Do not
open a browser.

## Step 1: List what is waiting

Call `list_pending_restream_clips` with `limit: 3` (and `brand` only when the
user or the task named one). It returns
`{ clips: [{ id, clipId, projectId, title, caption, hashtags, eventTitle, podId, clipCreatedAt, created_at }], more }`,
oldest first.

- **Empty** → report `restream-publish-clip: nothing to publish` and exit. This
  is the common case. Open no browser.
- **Unattended and outside 10:00–22:59 ET** → report
  `restream-publish-clip: N waiting, outside the publishing window` and exit.
- Otherwise take the **first** clip. Hold on to `id` (the tracker id for Step 9),
  `projectId`, `title`, `podId` and `clipId`. Do not publish any other clip this
  run; say how many are still waiting in the report.

## Step 2: Platform accounts and the YouTube title

Choose accounts by `podId`:

| podId prefix | TikTok            | YouTube           | Facebook                |
| ------------ | ----------------- | ----------------- | ----------------------- |
| `sotsp-*`    | Nick Paro         | Sick of this Show | _(not toggled)_         |
| `babm-*`     | Banner & Backbone | Banner & Backbone | Banner & Backbone Media |
| `lr-*`       | _(all available)_ | _(all available)_ | _(all available)_       |

For `lr-*` (Lev Remembers: `lr-vfu`, `lr-lr`) toggle on **every** account
listed under every platform. Any other prefix: attended, ask which accounts to
use; unattended, record `skipped` with reason `unknown series prefix` (Step 9)
and stop.

YouTube titles max out at 100 characters:

```
youtube_title = title; youtube_description = ""
if len(title) > 100:
    split at the first . ? or ! followed by a space (or at the end)
    found     → youtube_title = text up to and including it; description = the rest
    not found → youtube_title = title[:97].rstrip() + "..."
```

## Step 3: Pick the browser and check who is signed in

Read `../../references/browser-routing.md` first.

1. Call `get_restream_workspaces` and find the workspace whose `podIds` contains
   `podId`: its parent `accounts[i].id` picks the browser (`babm` → the Claude
   built-in browser, any other account → Chrome) and its `displayName` is the
   sidebar label. If the tool is missing or unauthorized, route by prefix
   (`babm-*` other than `babm-pv` → built-in browser, else Chrome) and switch
   workspaces by trial in Step 4.
2. If that browser is not available: attended, say which browser the account
   needs and stop; unattended, report the routing §1 skip line and stop. Never
   use the other browser.
3. Open `https://app.restream.io/home` in your own new tab, wait for the
   sidebar's "Workspaces" heading and run the routing §2 snippet. A login page or
   the wrong account → close your tab, publish nothing, record nothing, and
   report the routing §2 refusal line.
4. Click the sidebar item matching `displayName` (case-insensitive, truncation
   allowed; expand the account header first if needed). Verify with `read_page`
   that it is the active workspace.

In the built-in browser, use routing §3's driver table for every Chrome step
below, and end each script right before the Publish click.

## Step 4: Open the clip project

Navigate to `https://app.restream.io/clips/<projectId>` and confirm with
`read_page` that the project's clip list loaded. If it errors or bounces to the
clips index, a different workspace is probably active: try each other workspace
on this account in the same tab. If it fails in every one, record `failed` with
`project not found` (Step 9) and stop.

## Step 5: Find THIS clip in the project

List every clip in the project view with its title and published state. Match
`title` by the first rule that gives exactly one clip:

1. Exact title.
2. Case-insensitive title.
3. Substring either way, **only if exactly one clip matches**.

| Result                                  | Action                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Found, already shows "Published"        | Record `skipped`, reason `already published in Restream` (Step 9). Do not publish.     |
| Found, not published                    | Click **that clip's** Publish button. Continue.                                        |
| Not found                               | Record `failed`, error `clip title not found in project` (Step 9).                     |
| Several substring matches               | Attended: ask which. Unattended: record `skipped`, reason `ambiguous clip title`.      |

Confirm the publish modal shows this clip's title. If it opened on another clip,
close it (Escape, then **Leave**) and stop without recording anything.

## Step 6: Toggle the accounts

Enable only the Step 2 accounts and turn off any others that are on. Read the
toggle state first and change only what needs changing.

## Step 7: YouTube title and description

If the title was over 100 characters, set the YouTube title to `youtube_title`
and, when non-empty, the description to `youtube_description` (`form_input`).

## Step 8: Publish

Read the modal once more: the right clip, the right accounts, the YouTube
title. Then click **Publish Clips** in its own step (in the built-in browser,
its own script). Wait for the success toast, badge or modal close. If the UI
shows an error, capture its text and do not record `posted`.

## Step 9: Record the result (required)

Call `mark_restream_published` with the Step 1 `id`:

| What happened             | Call                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Published                 | `{ trackerId: id, status: "posted" }`                                     |
| Already published / skip  | `{ trackerId: id, status: "skipped", error: "<reason>" }`                 |
| Not found / publish error | `{ trackerId: id, status: "failed", error: "<first 200 chars>" }`         |

- `{ ok: true }` → recorded.
- `{ ok: false, error: "not_pending" }` → another run already recorded this
  clip. Report it; do not publish again.
- The call **throws** after a publish → the clip is live but not recorded. Do
  not close the tab. Report the CRITICAL line below and stop: the next run would
  otherwise list it again. Retry the same mark once before reporting.

## Step 10: Clean up and report

Close only the tabs this run opened (never sign out, never close the user's
tabs). Then report one of:

```
restream-publish-clip: posted "<title>" → TikTok (<account>), YouTube (<account>)[, Facebook (<account>)]; N still waiting
restream-publish-clip: skipped "<title>" (<reason>); N still waiting
restream-publish-clip: FAILED "<title>" (<error>); N still waiting
restream-publish-clip: CRITICAL "<title>" was published in Restream but the result was not recorded. Do not run this skill again until it is recorded.
```

`N` = the other clips from Step 1 (write `3+` when `more` was true).

## Error handling

| Situation                         | Action                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| Nothing waiting                   | One line, exit, no browser                                    |
| Account's browser not available   | Attended: say which browser; unattended: skip line            |
| Signed in as the wrong account    | Close own tab, record nothing, refusal line                   |
| Project not found in any workspace| Record `failed`                                               |
| Toggle or click blocked           | Attended: ask the user to click, then confirm; unattended: close the modal, record nothing, report |
| Publish returns an error          | Record `failed`                                               |
| Mark throws after publishing      | Retry once, then CRITICAL report, keep the tab                |

## Scheduled task

`references/templates/restream-publish-clips.md` in this plugin runs this skill
hourly from 10:00 to 22:00 ET on this computer. Install it with
`bb-scheduled-manager` using `--templates-dir` pointed at that folder.
