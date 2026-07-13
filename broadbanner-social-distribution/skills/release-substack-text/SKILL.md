---
name: release-substack-text
description: "Release queued Notes to Substack — text OR text+image. Uses the BroadBanner MCP connector to list the creator's pending posts (from the BannerBlast web composer or substack-note), posts each to Substack via browser automation (attaching the image in-page from R2 when the post carries one), and marks it released — no local credentials or config. Runs unattended on a schedule. Triggers on 'release my Substack posts' / 'post my pending notes', or the scheduled release task. Reuses substack-note's browser posting; the existing tracker is marked posted, not re-ingested."
---

# Release Substack Text Posts

A background, **unattended** skill: pull the creator's notes waiting to go out on
Substack — **text or text+image** — post each as a Note via browser automation, and
mark it released. Text-only notes just enter the text; text+image notes also fetch
the image from R2 and attach it in-page before posting.

This is the consumer half of the web post flow. The BannerBlast web composer (and the
substack-note skill) ingest a tracker with `substack: pending` (plus `bluesky` /
`threads`, which the Worker queue posts via API — including images). The Worker queue
**never** posts Substack — there's no API — so those notes sit `pending` until this
skill releases them through the browser.

**No local credentials, no config file.** Identity, context, and data all come from
the **BroadBanner MCP connector** (the creator signed in once via WorkOS). The browser
is used *only* for the actual Substack post. This is the post-CLI path — do **not**
look for `.creds/`, `broadbanner.config.json`, `~/.broadbanner/`, or `banner-blast init`.

## Prerequisite: the BroadBanner connector

This skill calls MCP tools from the **BroadBanner connector** (`mcp.broadbanner.com`):
`get_creator_context`, `list_pending_substack`, `mark_substack_posted`.

If those tools aren't available, the connector isn't added/connected. **Stop and report:**

> The BroadBanner connector isn't connected. In Cowork: Settings → Connectors → Add
> custom connector → `https://mcp.broadbanner.com/mcp` → sign in (WorkOS) with your
> creator email.

Do not fall back to `.creds/` or the CLI — that path is retired.

---

## Step 1: List pending posts

Call the **`list_pending_substack`** tool. It returns
`{ posts: [ { id, text, created_at, imageUrl?, altText? } ] }` for the signed-in creator.

- **If `posts` is empty → exit immediately** with a one-line "nothing pending" report.
  Do **not** open a browser. This is the common, cheap path.

Otherwise, sort `posts` oldest-first by `created_at`. Cap this run at **5** — process the
oldest 5 and note any remainder goes out next run.

**A post with an `imageUrl` is a text+image note.** `imageUrl` is the public
`media.broadbanner.com` URL you fetch in-page (Step 3a-image) to attach the image before
posting; `altText` (if present) is its accessibility description. Text-only posts have no
`imageUrl` and skip the injection step entirely.

---

## Step 2: Resolve the Substack account + select the browser

Call **`get_creator_context`** → `{ substackHandle, brand, brands, pods, ... }`. You need
`substackHandle` (e.g. `nickparo`) — that's the Substack account these notes post to.

Substack posting is browser automation (Option A — a local logged-in browser). There is
**no brand→profile config**; the account is identified by `substackHandle`:

1. `list_connected_browsers`. If none are connected → **stop and report** (no browser to drive).
2. Select a connected browser. Open a **dedicated MCP working tab** with `tabs_create_mcp`
   and **record its tabId in a running `OPENED_TABS` list** — do not hijack the user's
   current tab, and track every tab you open so Step 4 can close exactly the skill's own
   tabs. In that tab, `navigate` to `https://substack.com/@{substackHandle}` and
   `resize_window` to **1200×900**.
3. **Verify you are logged in as `{substackHandle}`** (the profile page shows that account).
   - Wrong account, or a login screen → **clean up (Step 4) and stop**, telling the user to
     log into `{substackHandle}`'s Substack in the browser Cowork drives. Posting under the
     wrong identity is a public mistake — never guess across profiles.
   - (Multiple connected browsers? Pick the one logged into `{substackHandle}`. A creator
     with several distinct Substack accounts is an edge case — handle the one matching
     `substackHandle` and flag the rest.)

Reuse this one working tab for every post in the run — the verification in Step 3a reloads
it in place rather than opening new tabs, so the run stays at a single tab.

---

## Step 3: For each pending post — post to Substack, then mark released

Process posts **one at a time**. For each `{ id, text, imageUrl?, altText? }`:

### 3a. Post the note to Substack (browser)

Reuse substack-note's TEXT NOTE path — see `../substack-note/SKILL.md` Steps 2–5b and
`../substack-note/references/js-verification.md`. Load-bearing steps:

1. On `https://substack.com/@{substackHandle}` (window 1200×900), capture the baseline
   top-note text.
2. Click "What's on your mind?" in the notes body (not the nav bar). Verify the
   `[role="dialog"]` modal + `.ProseMirror` editor opened.
3. Enter the text with **JavaScript** (never the `type` action):
   `document.execCommand("insertText", false, \`<text>\`)` — backtick template so line
   breaks / em dashes / curly quotes survive. Confirm `editorText` is non-empty.
4. **If the post has an `imageUrl`, attach the image now (Step 3a-image below) — before
   clicking Post.** Text-only posts skip straight to step 5.
5. Confirm the Post button is enabled. **Click Post exactly once**, then immediately
   `postBtn.disabled = true` AND `postBtn.style.pointerEvents = "none"`. Never click Post
   twice.
6. Wait 6s (longer for image posts — they upload), reload the tab, verify the note appears
   (baseline changed OR the first 60 chars are present).

**ANTI-DUPLICATE GUARD:** before any retry, re-check the profile — a post may have
succeeded even if the modal misbehaved. Never re-click Post on an ambiguous result.

### 3a-image. Inject the image from R2 (image posts only — the load-bearing trick)

Only for posts that carry an `imageUrl`. This mirrors the video-clip injection in
`../release-substack-clips/SKILL.md` Step 3b, targeting the **image** file input. Run in the
composer tab via `javascript_tool` (substitute `IMAGE_URL` + a filename). It fetches the
image cross-origin, wraps it in a `File`, and hands it to the hidden image input:

```js
(async () => {
  try {
    const IMAGE_URL = "<imageUrl>";
    const resp = await fetch(IMAGE_URL);
    if (!resp.ok) return JSON.stringify({ ok:false, stage:"fetch", status:resp.status });
    const blob = await resp.blob();
    const file = new File([blob], "note-image", { type: blob.type || "image/jpeg" });
    const input = [...document.querySelectorAll('input[type=file]')]
      .find(i => (i.accept || '').includes('image'));
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
  consuming the input — **expected**, not a failure.
- `stage:"exception"` with `Failed to fetch` → **CORS not configured** on the media
  endpoint. Mark this post `failed` (`error: "media CORS not configured"`) and skip it.
- `stage:"fetch"` with 403/404 → object missing / WAF-blocked. Mark `failed` with the
  status and skip.
- `stage:"no-input"` → the composer hasn't exposed an image input; if the note text was
  already entered, cancel the modal and mark `failed` (`error: "no image input"`).

After a successful hand-off, **wait for the image tile to render** (poll up to 60s): ready
when an `<img>` preview / attachment tile exists in the dialog AND Post is enabled. If the
poll expires, cancel the modal and mark `failed` (`error: "image did not render"`). Never
click Post against an unrendered upload.

### 3b. Mark released (MCP tool)

- **On success:** call **`mark_substack_posted`** with `{ trackerId: "<id>", status: "posted" }`.
- **On failure** (post never confirmed, *after* the anti-duplicate profile re-check): call
  **`mark_substack_posted`** with `{ trackerId: "<id>", status: "failed", error: "<short reason>" }`
  so it isn't retried forever.

Then proceed to the next post. The browser stays selected across iterations.

---

## Step 4: Clean up the browser, then report

**Browser cleanup is mandatory and runs on EVERY exit path** — success, a per-post failure,
a wrong-account/login abort, or any unexpected stop **once a tab has been opened**. This is
an unattended skill that runs on a schedule; a leaked tab is leaked forever and Chrome
accumulates one per failed run. Treat this as a `finally`: never `stop and report` without
first running the sweep below.

Close the browser tabs the skill opened:

1. `tabs_context_mcp` to enumerate the MCP tab group.
2. `tabs_close_mcp` for **each** tab in that group (this catches your `OPENED_TABS` working
   tab plus anything else the run spawned). Closing the whole MCP group is safe — these are
   the skill's own tabs, never the user's.
3. If a `tabs_close_mcp` call fails, **log a warning and keep going** — close the remaining
   tabs and finish the report. A cleanup error must not block the run or leave siblings open.

(If you exit before any tab was opened — empty queue in Step 1, connector missing, no
connected browser — there is nothing to close; skip straight to the report.)

Report:

```
Released N Substack post(s):
  • {POST_ID_1} — posted
  • {POST_ID_2} — failed (composer did not confirm)
{M remaining — will release on the next scheduled run}   (only if capped)
```

Worker KV is the system of record; no local files are written. Bluesky and Threads for
these posts are handled separately by the BannerBlast Worker queue — this skill only
touches Substack.

---

## Critical rules

- **Unattended — never block on a prompt.** If something's missing (connector, handle,
  browser/login), clean up the browser (Step 4) and report; don't ask and wait.
- **Always clean up the browser before exiting.** Once a tab is open, every exit path —
  success or failure — runs the Step 4 sweep first. A scheduled skill that leaks a tab per
  failed run bloats Chrome indefinitely.
- **One working tab, reused.** Open one MCP tab in Step 2, reload it for verification, close
  it (and any siblings) in Step 4. Track tabIds in `OPENED_TABS`; never hijack the user's
  current tab.
- **Never click Post more than once.** Verify against the profile before any retry.
- **Window must be 1200×900** or the composer modal dismisses.
- **Image posts: fetch + inject, never download-to-disk.** For a post with `imageUrl`, attach
  it in-page (Step 3a-image) BEFORE clicking Post, and wait for the `<img>` tile — not just an
  enabled Post button. CORS (`Failed to fetch`) is the only external dependency and is not
  retryable from the skill — mark `failed` and move on. `input.files` reading 0 after
  injection is success, not failure.
- **Empty queue is normal** — fast-exit without touching Substack (no tab opened, nothing to
  clean up).
- **Missing tools = connector not connected.** Do NOT fall back to `.creds/` or the CLI.
- **One post at a time.** Post → mark → next. Never batch the browser posts.

## See also

- `../substack-note/SKILL.md` — the browser-posting steps (Steps 2–5b).
- `../substack-note/references/js-verification.md` — ProseMirror text-entry + Post-button verification.
- `../substack-note/references/error-handling.md` — extended failure modes.
- `../release-substack-clips/SKILL.md` — the video sibling; its Step 3b is the same fetch→File→input
  injection trick this skill uses for images (Step 3a-image).
