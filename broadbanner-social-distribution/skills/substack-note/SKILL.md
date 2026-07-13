---
name: substack-note
description: "Post a text Note to Substack, OR queue a text+image note (Substack + Bluesky + Threads) via the BroadBanner MCP connector — no local credentials, config, or tracker files. Use when the user wants to post a note, says 'post this to Substack' / 'share this as a note', or sends an image+caption. Text path: browser-posts to Substack, then queues Bluesky/Threads via post_text. Image path: no browser — post_image queues Bluesky/Threads now; Substack releases later via release-substack-text (which attaches the image). Worker KV is SoT."
---

# Substack Note

Post a text Note to Substack, or queue a text+image note for all three platforms — entirely through the **BroadBanner MCP connector** (`mcp.broadbanner.com`).

Two branches:

- **Text note** — browser automation posts to Substack, then the skill calls the **`post_text`** tool with `substackPosted: true` (Substack recorded posted; Bluesky/Threads queued).
- **Text+image note** — no browser here. The skill calls the **`post_image`** tool with the image (a public URL or base64 bytes); the connector uploads to R2 and queues Bluesky/Threads **immediately** (they post images via API), while Substack is left **pending** and released later by the scheduled `release-substack-text` skill, which fetches the image from R2 and posts it as a Note. (Substack has no posting API, so the image goes out on the browser-release schedule, not the instant this skill runs.)

**No local credentials, no config file, no tracker JSON.** Identity, the Substack handle, and the authorized pods all come from the connector (the creator signed in once via WorkOS). The browser is used *only* for the actual Substack text post. This is the post-CLI path — do **not** look for `broadbanner.config.json`, `.creds/`, `~/.broadbanner/`, `banner-blast init`, a cap-token, or HMAC signing.

---

## Step 0: Prerequisite — the BroadBanner connector

This skill calls MCP tools from the **BroadBanner connector**: `get_creator_context`,
`post_text`, and (image branch) `post_image`.

If those tools aren't available, the connector isn't added/connected. **Stop and report:**

> The BroadBanner connector isn't connected. In Cowork: Settings → Connectors → Add custom
> connector → `https://mcp.broadbanner.com/mcp` → sign in (WorkOS) with your creator email.

Do not fall back to `broadbanner.config.json`, `.creds/`, or the CLI — that path is retired.

## Step 0.5: Resolve identity from the connector

Call **`get_creator_context`** → `{ substackHandle, brand, brands, pods, ... }`. Capture:

| Variable          | Source                          | Example      |
| ----------------- | ------------------------------- | ------------ |
| `SUBSTACK_HANDLE` | `substackHandle`                | `"nickparo"` |
| `PODS`            | `pods` (authorized series ids)  | `["sotsp-im", "babm-afbc"]` |

If a **brand** was explicitly passed to this run (e.g. the task says `brand: babm`), pass it
to `get_creator_context` so `substackHandle` resolves to that brand's account. Otherwise run
brandless — `substackHandle` is the creator's default handle.

If `substackHandle` is null, ask once: "What's your Substack username?" — but never guess a
handle; posting under the wrong account is a public mistake.

There is no `USER_ID`, no cap-token, and no Chrome-profile config to load — the connector
asserts identity, and the browser profile is selected **by handle** (Step 1.5).

---

## Branch: detect note type

| Signal                                                              | Branch                   |
| ------------------------------------------------------------------- | ------------------------ |
| "image note", "post this image", file path or URL alongside caption | Text+Image Note (Steps A1–A3) |
| "post this note", text only, no image reference                     | Text Note (Steps 1–7)    |

When ambiguous: ask once — "Is this text-only, or do you want to include an image?"

---

## TEXT+IMAGE NOTE PATH (Steps A1–A3)

This path uses **no browser**. The skill hands the image to the connector's **`post_image`**
tool, which uploads it to R2 and ingests a text+image tracker: **Bluesky/Threads queue
immediately** (they post images via API), and **Substack is left pending** for the scheduled
`release-substack-text` skill to post via browser (it attaches the image from R2). Full
release — all three platforms — just with Substack on the release schedule rather than instant.

### Step A1: Confirm caption, image, and pod

Resolve the pod from `PODS` (the `get_creator_context.pods` captured in Step 0.5):

1. If the user tagged a pod explicitly → use that pod ID (it must be in `PODS`).
2. Else if `PODS` has exactly one entry → use it.
3. Else show the `PODS` list and ask the user to pick. Store as `POD_ID`.

Show confirmation:

```
I'll queue this as a text+image note for Bluesky, Threads, and Substack
(Bluesky/Threads post shortly; Substack goes out on the next scheduled release):

Caption:  {caption text}
Image:    {filename or URL}
Alt text: {alt text or "(none — recommended to add one)"}
Pod:      {pod id}

Ready to queue?
```

### Step A2: Resolve the image into a `post_image` argument

`post_image` accepts the image as **either** a public URL **or** base64 bytes. Prefer the URL.

- **Public HTTPS URL** → pass `imageUrl` verbatim. The connector fetches it server-side; no
  download, no base64. This is the preferred path.
- **Local file in the workspace** → read the bytes and base64-encode them, then pass
  `imageBase64` + `mime`. Detect MIME first (e.g. `file --mime-type -b <path>`).

Validate before calling: MIME must be `image/jpeg`, `image/png`, `image/gif`, or
`image/webp`, and the image must be ≤ 5 MB. Fail loud on violations — the connector enforces
the same limits and will reject otherwise.

### Step A3: Queue via `post_image`, then report

Call **`post_image`** with `{ caption, podId, altText?, (imageUrl | imageBase64 + mime) }`.
Append the brand from Step 0.5 only if one was explicitly passed to this run. The caption is
the exact note text. Response: `{ trackerId, r2Key, publicUrl }`.

If `post_image` errors, surface the message and stop — common causes are an unauthorized pod
(not in `PODS`), an oversized/unsupported image, or an unreachable backend. Do **not** fall
back to a cap-token, `POST /v1/posts/media`, or a local tracker.

Report:

```
Text+image note queued
Tracker ID: {trackerId}

  Substack: pending (releases on the next scheduled run)
  Bluesky:  queued
  Threads:  queued
```

No browser opened, no local files written. Worker KV is the system of record. The image is
now in R2; the scheduled `release-substack-text` skill will fetch it and post the Substack
Note on its next run. (If the user only wants Bluesky/Threads and no Substack, pass
`targets: { substack: false }` to `post_image` — then Substack is recorded skipped.)

---

## TEXT NOTE PATH (Steps 1–7)

### Step 1: Confirm the note text

Show the user what will be posted and wait for confirmation:

```
I'll post this as a Substack Note:

> {note text}

Ready to proceed?
```

Once confirmed, post without asking again.

**Pre-approved notes:** if the dispatch prompt says the note is pre-approved, skip this step. Go straight to Step 1.5.

### Step 1.5: Select the browser logged into `@{SUBSTACK_HANDLE}`

The account is identified **by handle**, not by a config map. The right browser is the one
already logged into `@{SUBSTACK_HANDLE}` (a multi-brand operator keeps each brand's Substack
in its own Chrome profile, so selecting by handle picks the correct one):

```
list_connected_browsers → pick the entry logged into @{SUBSTACK_HANDLE}
select_browser({ deviceId: <matching deviceId> })
```

Skip if the current browser already matches. Login is verified for real in Step 2 (the
profile page must show `@{SUBSTACK_HANDLE}`). If no connected browser is logged into that
handle, **stop and tell the user** to log into `@{SUBSTACK_HANDLE}`'s Substack in the browser
Cowork drives — posting under the wrong account is a public mistake. Suggest pairing it via
`switch_browser`.

### Step 2: Open the browser, navigate, and capture baseline

Do all of this in **one `browser_batch` call**:

1. `tabs_create_mcp` → record `tabId`
2. `resize_window` to **1200×900** (wider viewports cause coordinate mismatches that dismiss the modal)
3. `navigate` to `https://substack.com/@{SUBSTACK_HANDLE}`

Wait 3 seconds. Verify the profile is visible and the user is logged in. If a login prompt appears, stop and ask the user to log in manually.

**Capture baseline** via a single `javascript_tool` call:

```javascript
const notes = document.querySelectorAll(
  '[data-testid="note"], .note-card, article',
);
const topNoteText =
  notes.length > 0 ? notes[0]?.textContent?.trim().slice(0, 200) : "";
JSON.stringify({ topNoteText, noteCount: notes.length });
```

If the selector returns empty, fall back to `get_page_text` for the baseline. Store the result for Step 5b comparison.

### Step 3: Open the note composer

Click the "What's on your mind?" prompt in the notes section body — NOT the nav bar (that opens a search overlay).

Verify the modal opened via **one JS call**:

```javascript
const modal = document.querySelector('[role="dialog"]');
const editor = modal?.querySelector(".ProseMirror");
JSON.stringify({
  modalFound: !!modal,
  editorFound: !!editor,
  editorRect: editor?.getBoundingClientRect(),
});
```

If the modal isn't found, use `find` to locate a "New post" button as a fallback. Wait 2 seconds after clicking.

### Step 4: Enter the note text (JS-first)

**Go straight to JavaScript insertion. Do not attempt the `type` action — it fails ~50% of the time on ProseMirror and wastes turns.**

Single `javascript_tool` call:

```javascript
const modal = document.querySelector('[role="dialog"]');
const editor = modal?.querySelector(".ProseMirror");
const p = editor.querySelector("p");
const range = document.createRange();
range.selectNodeContents(p);
range.collapse(true);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);
document.execCommand("insertText", false, `<NOTE TEXT HERE>`);
const postBtn = Array.from(modal?.querySelectorAll("button") || []).find(
  (b) => b.textContent?.trim() === "Post",
);
JSON.stringify({
  editorText: editor?.textContent,
  postEnabled: !postBtn?.disabled,
});
```

Replace `<NOTE TEXT HERE>` with the actual note text. Use a backtick-escaped template literal to preserve line breaks and special characters (em dashes, ellipses, curly quotes).

Entry succeeds when `editorText` is non-empty AND `postEnabled` is `true`.

If `postEnabled` is `false` after text appears, wait 1 second and re-check — ProseMirror's button-state update is asynchronous.

If `editorText` is empty after the JS call, cancel the modal (Escape), reopen the composer (Step 3), and retry once. If still empty, stop and report.

### Step 4b: URL hyperlink and preview (URL notes only)

Skip if no trailing URL in the note text.

After text entry, append a single space via JS to trigger link detection:

```javascript
document.execCommand("insertText", false, " ");
```

Poll every 3 seconds (up to 15 seconds) for a preview card: `[class*="link-preview"], [class*="linkPreview"], [class*="embed"]`. Proceed after the card appears or after 15 seconds. A missing preview is not a failure.

**Do not include the trailing space in the tracker's `text` field.**

### Step 5: Post the note

Single `javascript_tool` call — click Post and immediately disable it:

```javascript
const modal = document.querySelector('[role="dialog"]');
const postBtn = Array.from(modal?.querySelectorAll("button") || []).find(
  (b) => b.textContent?.trim() === "Post",
);
postBtn.click();
postBtn.disabled = true;
postBtn.style.pointerEvents = "none";
("clicked-and-disabled");
```

**Never click Post more than once.** Both `.disabled` and `.style.pointerEvents = 'none'` are required — the CSS `:disabled` pseudo-class alone is insufficient to block a fast second click.

### Step 5b: Verify the post (same tab)

Wait 6 seconds after posting, **reload the current tab**, then check:

```javascript
const notes = document.querySelectorAll(
  '[data-testid="note"], .note-card, article',
);
const topNoteText =
  notes.length > 0 ? notes[0]?.textContent?.trim().slice(0, 200) : "";
const hasNote = document.body.textContent.includes(
  "<FIRST 60 CHARS OF NOTE TEXT>",
);
JSON.stringify({ topNoteText, hasNote });
```

Compare against the Step 2 baseline. If the top note changed or `hasNote` is true, the post succeeded.

If ambiguous: wait 5 seconds, reload once more, re-check. If still absent after 2 checks, **do NOT click Post again**. Report failure.

**ANTI-DUPLICATE GUARD:** Before any retry at any point in this workflow, verify against the profile first. A post may have succeeded even if the modal behaved unexpectedly.

### Step 6: Queue Bluesky/Threads via `post_text`

The Substack post is already live (browser). Now hand the same text to the connector so the
Worker queue posts Bluesky and Threads — call the **`post_text`** tool:

```
post_text({ text: "<NOTE_TEXT>", substackPosted: true })
```

- `text` is the **exact posted text** — no trailing space, no URL-detection space from Step 4b.
- `substackPosted: true` is **load-bearing**: it records the Substack slot `posted` (you just
  posted it) instead of queuing it, so the scheduled `release-substack-text` drain does not
  post it a second time. Omitting it would double-post Substack.
- If a brand was explicitly passed to this run, `get_creator_context` in Step 0.5 already
  resolved the matching handle; no brand argument is needed on `post_text`.

Response: `{ trackerId }`. The connector schedules Bluesky/Threads downstream.

**On failure:** if `post_text` errors, the **Substack post already succeeded** — do NOT
re-post on Substack. Report the queue failure separately:

> The Substack note posted, but queuing Bluesky/Threads via the connector failed ({error}).
> The note is live on Substack; the cross-post can be retried once the connector is reachable.

Do **not** fall back to a cap-token, an in-browser `fetch` to the gateway, or HMAC — those
paths are retired.

### Step 7: Clean up and report

Close every tab the skill opened: `tabs_context_mcp` → `tabs_close_mcp` for each tab in the
MCP group. **Run this even if Step 6 failed** — once a tab is open, clean it up before
reporting; never leave the browser tab behind.

Report:

```
Note posted to Substack
Tracker ID: {trackerId}

  Substack: posted
  Bluesky:  queued
  Threads:  queued
```

Worker KV is the system of record. No local tracker files are written.

Note on latency: typical ingest→posted is 1–15 minutes on Bluesky, with Threads following 5–15 seconds later. If the user wants real-time confirmation, point them at Bluesky / Threads directly.

---

## Error handling

### Critical rules

- **Never retry the Post button.** If verification is ambiguous, check the profile before any retry.
- **Anti-duplicate guard applies to ALL retries.** Before reopening the composer, re-entering text, or re-attempting Post, check the profile first.
- **Modal disappearing unexpectedly** means the window was not resized to 1200×900 in Step 2.
- **`post_text` fails after a successful Substack post:** do NOT re-post on Substack. Report the queue failure separately — the note is already live on Substack.
- **`post_text` must carry `substackPosted: true`** on the text path — without it, Substack is queued and the scheduled drain double-posts the note.
- **Connector tools missing** (`get_creator_context` / `post_text` / `post_image`): the connector isn't connected. Stop and report (Step 0) — never fall back to `.creds/`, a cap-token, or the CLI.

### Not logged in

Login prompt visible instead of profile → stop, tell the user to log in manually.

### Modal doesn't open

1. Use `find` to locate a "New post" button.
2. If found, click and wait 2 seconds.
3. If not found, suggest page refresh.

### Text entry fails

1. Cancel modal (Escape).
2. **Check profile for the note** (anti-duplicate guard).
3. Reopen composer from Step 3.
4. Retry JS insertion once.
5. If still failing, stop and report.

### Post button stays disabled

1. Wait 1 second, re-check (up to 3 times).
2. ProseMirror's button state is async — the content model may not have synced.
3. If still disabled after 3 checks, cancel modal, check profile, retry fresh.

---

## Turn budget

A clean text note run should complete in **25–35 assistant turns**:

| Phase             | Target turns | Notes                                                          |
| ----------------- | ------------ | -------------------------------------------------------------- |
| Setup + identity  | 1–2          | `get_creator_context` — one tool call, no files               |
| Browser posting   | 8–12         | Navigate + baseline, open composer, JS insert, JS post        |
| Verification      | 2–4          | Reload + JS check on same page                                 |
| Queue cross-posts | 1–2          | One `post_text` tool call (`substackPosted: true`)            |
| Cleanup + report  | 2–3          | Close tabs, format report                                      |

If a run exceeds 50 turns, something went wrong. Surface which phase ballooned.

---

## See also

- `references/js-verification.md` — deep dive on ProseMirror text-entry and Post-button verification.
- `references/error-handling.md` — extended failure modes and recovery paths.
- `../release-substack-text/SKILL.md` — the scheduled drain that posts `post_text`'s queued Substack notes (it must NOT receive ones this skill already posted, hence `substackPosted: true`).

(The legacy gateway-cap-token and HMAC paths — and `references/bb-distro-auth.md` — were removed in the connector cutover. This skill holds no local credentials.)
