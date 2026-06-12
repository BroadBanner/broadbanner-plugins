---
name: release-substack-clips
description: "Release queued video clips to Substack as Notes. Uses the BroadBanner MCP connector to list the creator's pending clips (from the restream-clip pipeline), fetches each clip in-page from R2, posts it as a Substack video Note via browser automation, and marks it released — no local credentials, config, or tracker files. Runs unattended on a schedule. Triggers on 'release my Substack clips' / 'post my pending clips', or the scheduled clip-release task. Replaces the refill-clip-queue + drain-clip-queue pair."
---

# Release Substack Clips

A background, **unattended** skill: pull the creator's video clips waiting to go out on
Substack, post each as a video Note via browser automation, and mark it released.

This is the video sibling of `release-substack-text`, and it **replaces the old
`refill-clip-queue` + `drain-clip-queue` pair** (the local-queue producer/consumer
split existed only because Cowork bash had no network — the MCP connector does, so the
two collapse into this one self-contained skill).

**No local credentials, no config file, no local queue.** Identity, context, and the
clip list all come from the **BroadBanner MCP connector** (the creator signed in once
via WorkOS). The browser is used *only* for the actual Substack post. This is the
post-CLI path — do **not** look for `.creds/`, `broadbanner.config.json`,
`~/.broadbanner/`, the local clip-queue, or `banner-blast init`.

## Prerequisite: the BroadBanner connector

This skill calls MCP tools from the **BroadBanner connector** (`mcp.broadbanner.com`):
`get_creator_context`, `list_pending_clips`, `mark_substack_posted`.

If those tools aren't available, the connector isn't added/connected. **Stop and report:**

> The BroadBanner connector isn't connected. In Cowork: Settings → Connectors → Add
> custom connector → `https://mcp.broadbanner.com/mcp` → sign in (WorkOS) with your
> creator email.

Do not fall back to `.creds/` or the CLI — that path is retired.

---

## Step 1: List pending clips

Call the **`list_pending_clips`** tool. It returns
`{ clips: [ { id, mediaUrl, caption, hashtags, podId, created_at } ] }` for the
signed-in creator. Each clip is a `restream-clip` tracker whose Substack slot is pending.

- **If `clips` is empty → exit immediately** with a one-line "nothing pending" report.
  Do **not** open a browser. This is the common, cheap path.

Otherwise, sort `clips` oldest-first by `created_at`. **Cap this run at 2** — video posts
are slow and heavy; process the oldest 2 and note any remainder goes out next run.

For each clip, build the note text: `caption` (already includes the title fallback from
the Gateway), then append any `hashtags` not already present, space-separated, each
prefixed with `#` if not already. `mediaUrl` is the **public** `media.broadbanner.com`
URL the composer fetches in-page — use it verbatim; do not rewrite or sign it.

---

## Step 2: Resolve the Substack account + select the browser

Call **`get_creator_context`** → `{ substackHandle, brand, brands, pods, ... }`. You need
`substackHandle` (e.g. `nickparo`) — the Substack account these clips post to.

Substack posting is browser automation (Option A — a local logged-in browser). There is
**no brand→profile config**; the account is identified by `substackHandle`:

1. `list_connected_browsers`. If none are connected → **stop and report** (no browser to drive).
2. Select a connected browser; `navigate` to `https://substack.com/@{substackHandle}` and
   `resize_window` to **1200×900**.
3. **Verify you are logged in as `{substackHandle}`** (the profile page shows that account).
   - Wrong account, or a login screen → **stop and tell the user** to log into
     `{substackHandle}`'s Substack in the browser Cowork drives. Posting under the wrong
     identity is a public mistake — never guess across profiles.

---

## Step 3: For each pending clip — post to Substack, then mark released

Process clips **one at a time**. For each `{ id, mediaUrl, caption, hashtags }`:

Reuse `substack-video-note`'s posting flow exactly — see `../substack-video-note/SKILL.md`
Steps 2–7 and `../substack-note/references/js-verification.md`. The **only** substitutions:
identity/context/data come from the MCP tools above (not a tracker file or config), and
`MEDIA_URL` is the clip's `mediaUrl` (not built from `clip.r2_key`). Load-bearing steps:

### 3a. Open the composer and enter the note text

1. On `https://substack.com/@{substackHandle}` (window 1200×900), capture the baseline
   top-note text.
2. Click "What's on your mind?" in the notes body. Verify the `[role="dialog"]` modal +
   `.ProseMirror` editor opened.
3. Enter the note text with **JavaScript** (never the `type` action):
   `document.execCommand("insertText", false, \`<text>\`)`. Confirm `editorText` is
   non-empty. Do **not** click Post yet — the video must attach first.

### 3b. Inject the video from R2 (the load-bearing trick)

Run this in the composer tab via `javascript_tool` (substitute `MEDIA_URL` and a
filename). It fetches the clip cross-origin, wraps it in a `File`, and hands it to the
hidden video input:

```js
(async () => {
  try {
    const MEDIA_URL = "<mediaUrl>";
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

- `ok:true` → handed off. Re-reading `input.files` as length 0 afterward is Substack
  consuming/resetting the input — **expected**, not a failure.
- `stage:"exception"` with `Failed to fetch` → **CORS not configured** on the media
  endpoint. Mark this clip `failed` (`error: "media CORS not configured"`) and skip it.
- `stage:"fetch"` with a 403/404 → object missing or WAF-blocked. Mark `failed` with the
  status and skip.

After a successful hand-off, **wait for the upload to render** (poll up to 90s): ready
when a `<video>` element / attachment tile exists in the dialog AND Post is enabled. If
the poll expires, cancel the modal and mark `failed` (`error: "upload did not render"`).
Never click Post against an unrendered upload.

### 3c. Post and verify

1. **Click Post exactly once**, then immediately `postBtn.disabled = true` and
   `postBtn.style.pointerEvents = "none"`. Never click Post twice. Wait up to 20s for the
   modal to dismiss (video posts are slow).
2. Open a second tab to `https://substack.com/@{substackHandle}`, wait 5s, confirm the
   new note is present AND differs from the Step 3a baseline. **ANTI-DUPLICATE GUARD:**
   before any retry, re-check the profile — the post may have succeeded even if the modal
   misbehaved. Video uploads are slow, so the false-"failure" window is wide — be
   conservative. Never re-click Post on an ambiguous result.

### 3d. Mark released (MCP tool)

- **On success:** call **`mark_substack_posted`** with `{ trackerId: "<id>", status: "posted" }`.
- **On failure** (after the anti-duplicate profile re-check): call **`mark_substack_posted`**
  with `{ trackerId: "<id>", status: "failed", error: "<short reason>" }` so it isn't
  retried forever.

Then proceed to the next clip. The browser stays selected across iterations.

---

## Step 4: Clean up and report

Close all MCP tabs (`tabs_context_mcp` → `tabs_close_mcp`). Report:

```
Released N Substack clip(s):
  • {CLIP_ID_1} — posted
  • {CLIP_ID_2} — failed (upload did not render)
{M remaining — will release on the next scheduled run}   (only if capped)
```

Worker KV is the system of record; no local files are written. Bluesky and Threads for
these clips are handled separately — this skill only touches Substack.

---

## Critical rules

- **Unattended — never block on a prompt.** If something's missing (connector, handle,
  browser/login), stop and report; don't ask and wait.
- **Never click Post more than once.** Verify against the profile before any retry.
- **Window must be 1200×900** or the composer modal dismisses.
- **Empty queue is normal** — fast-exit without touching Substack.
- **Fetch + inject, never download-to-disk.** No 10 MB cap, no native file picker, no
  `media:write` token. CORS (`Failed to fetch`) is the only external dependency and is
  not retryable from the skill.
- **`input.files` reading 0 after injection is success**, not failure.
- **Wait for the `<video>`/attachment tile**, not just an enabled Post button.
- **Cap 2 clips per run** — video is heavy; let the schedule pace the rest.
- **Missing tools = connector not connected.** Do NOT fall back to `.creds/`, the local
  clip-queue, or the CLI.
- **One clip at a time.** Post → mark → next. Never batch the browser posts.

## See also

- `../substack-video-note/SKILL.md` — the video-injection + posting steps (Steps 2–7).
- `../substack-note/references/js-verification.md` — ProseMirror text-entry + Post-button verification.
- `release-substack-text/SKILL.md` — the text-only sibling (same MCP-connector pattern).
