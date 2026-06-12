---
name: substack-video-note
description: >
  Post a Substack Note with an attached video clip. Use when the user wants to
  publish a Substack Note with a video, post a Restream clip to Substack, or
  says "post this clip to Substack", "upload this video as a note", or "post the
  clip note". Also triggers when draining a Social-Distribution tracker whose
  source is restream-clip and substack status is pending. Fetches the clip from
  R2 in-page and injects it into the composer (no local file), posts via browser
  automation, and updates the tracker JSON in-place — does NOT create a new
  tracker or cross-post to Bluesky/Threads.
---

# Substack Video Note

Post a Substack Note with an attached video and update the
`Social-Distribution/` tracker JSON for the clip in-place.

This skill is the video-capable sibling of `substack-note`. The text-only
flow lives in `substack-note/SKILL.md` — re-use its conventions where they
overlap. The differences are: an existing tracker is read as input, the
clip's video is **fetched from R2 directly inside the composer page and
injected into the note**, and the tracker is updated rather than created.

## How the video gets in (read this first)

The Substack Notes composer mounts a hidden `<input type="file"
accept="video/*">`. Substack has no public Notes API, so the video must be
attached through that input. This skill does **not** download the clip to
disk and does **not** use the browser MCP file-upload tool (that tool caps
at 10 MB and rejects agent-generated files — both fatal for real clips).

Instead it runs JavaScript **in the composer tab** that:

1. `fetch()`es the clip from `https://media.broadbanner.com/<r2_key>`,
2. wraps the bytes in a `File`,
3. assigns it to the video input via `DataTransfer`, and
4. dispatches a `change` event so Substack's handler picks it up.

This was validated end-to-end: Substack accepts the injected file (the
`isTrusted: false` synthetic event is not rejected, and the handler reads
from `input.files` and resets it). The only external dependency is **CORS**
— see the precondition below.

### ⚠️ CORS precondition

The composer runs on `https://substack.com`, so the cross-origin `fetch()`
of `media.broadbanner.com` only succeeds if the media endpoint returns
`Access-Control-Allow-Origin: https://substack.com` (or `*`). The
`broadbanner-media` bucket is served as an R2 custom domain on
`media.broadbanner.com`; the header is set by a Cloudflare **Modify Response
Header** Transform Rule on the `broadbanner.com` zone (hostname =
`media.broadbanner.com`). If that rule is not in place, the in-page fetch
throws `TypeError: Failed to fetch` — when that happens, mark
`platforms.substack` `failed` with `error: "media CORS not configured"` and
stop. Do not fall back to a local file or the file-upload tool.

## Inputs

This skill expects either:

1. A path to a tracker JSON in `<Publication>/Social-Distribution/` whose
   `source` is `restream-clip`, OR
2. An explicit `--text` and `--clip` (r2_key or media URL) pair (interactive use).

> **Note — two callers.** Interactively, this skill reads a tracker JSON (or an
> explicit `--text`/`--clip` pair) and updates the tracker in place. It is also
> the **browser-technique reference for `release-substack-clips`** (the scheduled
> clip flow): that skill reuses Steps 2–7 verbatim but sources identity/data from
> the BroadBanner MCP connector (`list_pending_clips` → `{ id, mediaUrl, caption }`)
> and marks release via the `mark_substack_posted` tool instead of editing a
> tracker file. The tracker-file steps (0, 1, 8) apply to the interactive path only.

When invoked interactively with a tracker path, fields read from the tracker:

- `clip.r2_key` — the canonical R2 object key (shape:
  `<pod-id>/videos/<clip-id>.mp4`). The media URL is built as
  `https://media.broadbanner.com/<r2_key>`. **Prefer `r2_key`** over
  `clip.public_url`, because older trackers stored a raw `pub-*.r2.dev` URL
  whose public access is disabled (403). If `r2_key` is absent, fall back to
  `clip.public_url` only if its host is `media.broadbanner.com`.
- `clip.caption` — note text. If `null`, fall back to `clip.title`.
- `clip.hashtags` — appended to the note text, space-separated, prefixed
  with `#` if not already.
- `clip.pod_id` — used for Chrome profile routing (Step 1.5).
- `platforms.substack.status` — must be `"pending"` (or `"queued"` if a caller
  set a soft lock before delegating). Anything else (`posted`/`skipped`/`failed`)
  → refuse and report.

## Step-by-step workflow

### Step 0: Ensure mount

Verify the active brand's host workspace — the mounted project root containing
`broadbanner.config.json` — is mounted. The tracker update in Step 8 MUST
target the existing JSON in the real host `Social-Distribution/` directory. If
the mount is unavailable and cannot be requested non-interactively, stop and
tell the user the tracker cannot be updated.

Also load `broadbanner.config.json` from the project root and capture:
- the `chromeProfiles` block — used in Step 1.5, and
- `SUBSTACK_HANDLE` = `user.handle` — the Substack Notes profile to post from
  (same resolution as `substack-note`). This is the user/personal Notes handle
  that fronts the publication, which may differ from the publication subdomain.
  If `user.handle` is absent, ask once for the handle.

### Step 1: Validate inputs

- Confirm the tracker file exists and parses as JSON.
- Confirm `source === "restream-clip"`.
- Confirm `platforms.substack.status` is `"pending"` or `"queued"`.
- Build `MEDIA_URL`: `https://media.broadbanner.com/<clip.r2_key>` (preferred),
  else `clip.public_url` if its host is `media.broadbanner.com`. If neither is
  available, mark `platforms.substack` `failed` with
  `error: "no media url"` and stop.
- Build the final note text: `caption || title`, then append any hashtags
  not already present in the caption, separated by spaces.

Show the user the resolved text and `MEDIA_URL` and ask for confirmation
ONLY when invoked interactively. When driven by `release-substack-clips`
(the unattended scheduled flow), skip confirmation — that skill is the
gating layer.

### Step 1.5: Select the correct Chrome profile

Before any browser action, switch to the profile that owns the Substack
account for this clip's pod. See `references/chrome-profile-routing.md`.

Quick version:

1. `chromeProfiles.byPodId[tracker.clip.pod_id]` (highest priority; `bySeriesId` is an accepted alias).
2. Else `chromeProfiles.byBrand[<brand for pod_id>]` (resolve brand via
   `pod_id` prefix or pod-map).
3. Else `chromeProfiles.default` (multi-brand contributor hubs that post every
   hosted show to one personal account set just this).
4. Else: skip the switch.

If a target profile resolved:

```
list_connected_browsers → find entry where name === <target profile>
select_browser({ deviceId: <matching deviceId> })
```

Skip if already selected. If no connected browser matches, **stop** —
posting under the wrong account is destructive.

### Step 2: Open the browser, resize, and capture baseline

Identical to `substack-note` Step 2:

```
resize_window: width=1200, height=900
navigate: https://substack.com/@{SUBSTACK_HANDLE}
wait 3s
```

Confirm the profile is visible and the user is logged in. Capture the
baseline top-note text (via `references/js-verification.md` or
`get_page_text`) for comparison in Step 7.

### Step 3: Open the note composer

Click "What's on your mind?" on the profile page. Wait 2 seconds. Verify the
ProseMirror dialog opened (modal verification snippet in
`../substack-note/references/js-verification.md`).

### Step 4: Enter the note text

Same as `substack-note` Step 4: click into the editor, then `type` the text.
Verify `editorText` is populated. Do NOT click Post yet.

### Step 5: Inject the video from R2

Run this in the composer tab via `javascript_tool` (substitute `MEDIA_URL`
and a filename). It fetches the clip cross-origin, wraps it in a `File`, and
hands it to the hidden video input:

```js
(async () => {
  try {
    const MEDIA_URL = "<MEDIA_URL>";
    const resp = await fetch(MEDIA_URL);
    if (!resp.ok) return JSON.stringify({ ok:false, stage:"fetch", status:resp.status });
    const blob = await resp.blob();
    const file = new File([blob], "<clipId>.mp4", { type: "video/mp4" });
    const input = [...document.querySelectorAll('input[type=file]')]
      .find(i => (i.accept || '').includes('video'));
    if (!input) return JSON.stringify({ ok:false, stage:"no-input" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input',  { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    return JSON.stringify({ ok:true, bytes:blob.size });
  } catch (e) {
    return JSON.stringify({ ok:false, stage:"exception", err:String(e) });
  }
})()
```

Interpreting the result:

- `ok:true` → the file was handed off. (Note: re-reading `input.files`
  afterward shows length 0 — that is Substack consuming and resetting the
  input, which is **expected and correct**, not a failure.)
- `stage:"exception"` with `Failed to fetch` → **CORS is not configured**
  (see precondition). Mark `failed` (`error: "media CORS not configured"`)
  and stop.
- `stage:"fetch"` with a status (403/404) → the object is missing or the
  WAF allowlist blocked this client. Mark `failed` with the status and stop.

After a successful hand-off, **wait for the upload to render** inside the
composer. Poll up to 90 seconds (video posts are slower than text): the
attachment is ready when a `<video>` element (or the attachment tile with a
remove control) exists inside the dialog AND the Post button is enabled.
Use the "Verify video attached" snippet in `references/js-verification.md`.

If the 90-second poll expires, cancel the modal and mark `failed`
(`error: "upload did not render"`). Do NOT click Post against an
unrendered upload.

### Step 6: Post

Click Post via JS exactly as in `substack-note` Step 5 (single click,
immediate disable). Wait up to 20 seconds for the modal to dismiss — video
posts take longer than text.

### Step 7: Verify in a second tab

Open a new tab to `https://substack.com/@{SUBSTACK_HANDLE}`, wait 5
seconds, capture the top note text, and confirm it is present AND differs
from the Step 2 baseline. If either check fails, wait 10 seconds and reload
once. If still absent, report failure. **Never re-post on the composer
tab** — see the anti-duplicate guard.

### Step 8: Update the tracker JSON

Update the existing tracker file in-place. On success set
`platforms.substack` to:

```json
{
  "status": "posted",
  "posted_at": "<ISO 8601 with timezone>",
  "url": "<profile URL or note permalink if discoverable>"
}
```

Leave `platforms.bluesky` and `platforms.threads` untouched — they are
drained independently by the BannerBlast Worker.

On any failure set `platforms.substack` to:

```json
{
  "status": "failed",
  "failed_at": "<ISO 8601>",
  "error": "<short reason>"
}
```

### Step 9: Clean up and report

Close all browser tabs opened by this skill and present a one-line summary:

```
Substack video note posted — tracker <basename> updated.
```

## Anti-duplicate guard

Same as `substack-note`: before ANY retry, open a new tab to the profile and
check whether the note text is already there. If present, treat the post as
successful and proceed to Step 8. Video uploads are slow, so the window for
false "failure" reads is wide — be especially conservative.

## Key technical notes

- **Fetch + inject, never download-to-disk.** The clip is fetched in-page
  from `media.broadbanner.com/<r2_key>` and injected via `DataTransfer`. This
  carries the **full-quality** clip at any size — no 10 MB cap, no native
  file picker, no `media:write` token.
- **CORS is the only external dependency.** A `Failed to fetch` means the
  `Access-Control-Allow-Origin` header is missing on the media endpoint; it
  is not a Substack problem and not retryable from the skill.
- **`input.files` reading 0 after injection is success**, not failure —
  Substack consumed the file on the dispatched `change` event.
- **Wait for the `<video>`/attachment tile**, not just an enabled Post
  button — Substack briefly enables Post mid-upload before re-disabling.
- **Tracker is updated in-place**, never duplicated. The dispatcher relies
  on this for idempotency.
- **Single source of truth for success is the second-tab profile read**,
  not modal state.
