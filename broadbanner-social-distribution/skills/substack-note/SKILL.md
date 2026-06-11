---
name: substack-note
description: "Post a text Note to Substack, OR queue an image note for Bluesky/Threads. Gateway-only auth (no HMAC). Use when the user wants to post a note or says 'post this to Substack', 'share this as a note', 'put this on notes'. Also triggers for image notes or any image+caption distribution request. Text-note path: posts to Substack via browser automation, then ingests the tracker into the BannerBlast Worker via the Gateway BFF. Image-note path: skips Substack, uploads image to R2 via the Gateway, then ingests. Worker KV is SoT; no local tracker JSON is written."
---

# Substack Note

Post a text Note to Substack, or queue an image note for Bluesky/Threads via the BroadBanner Gateway.

Two branches:

- **Text note** — browser automation posts to Substack, then the skill calls `POST /v1/posts` against the Gateway with Substack already marked posted and Bluesky/Threads pending.
- **Image note** — no browser. The skill uploads the image to R2 via `POST /v1/posts/media`, then calls `POST /v1/posts` with Substack skipped and Bluesky/Threads pending.

Both branches authenticate **gateway-only**: a capability-token Bearer header against `gateway.broadbanner.com`. There is no HMAC fallback. If the gateway is down, stop and report — do not attempt to sign requests against `api.broadbanner.com`. Worker KV is the system of record; no local tracker JSON is written.

---

## Step 0: Discover the project and read config

The Cowork dispatch enumerates the user's mounted workspaces in the system prompt under "User selected a folder". Read directly from those — **do not glob `/sessions/*/mnt/*/`**, it wastes turns and the enumeration is already present.

**1. Build the candidate list from the mounted workspaces** (folders the user has granted access to in this session). For each candidate, attempt a direct Read of `<workspace>/broadbanner.config.json`:

- Zero hits → call `mcp__cowork__request_cowork_directory`, ask the user to add their BroadBanner folder, retry.
- One hit → use it.
- Multiple hits → list them, ask which to use.

**2. Capture project variables from the config** (a single Read suffices — no `cat` shellout):

| Variable          | Source                               | Example                                                          |
| ----------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `PROJECT_ROOT`    | The mounted workspace path           | `/Users/<user>/NickParo`                                         |
| `PROJECT_ID`      | Basename of `PROJECT_ROOT`           | `"NickParo"`                                                     |
| `SUBSTACK_HANDLE` | `user.handle`                        | `"nickparo"`                                                     |
| `BRAND_SLUG`      | `user.brandSlugs[0]`                 | `"sotsp"` (short publication id; mirrors D1's `publications.id`) |
| `CHROME_PROFILE`  | `chromeProfiles.byBrand[BRAND_SLUG]` | `"Sick of this Shit Publications"`                               |

`USER_ID` (the UUIDv4 identity for the Distribution Worker) is **not** in this config — it lives in `.creds/`. See Step 0.5.

If `user.handle` is absent, ask once: "What's your Substack username?"

---

## Step 0.5: Load gateway credentials

**Two files, two Reads.** Both creds live inside the workspace `.creds/` directory:

```
<PROJECT_ROOT>/.creds/gateway.token   ← cap-token Bearer for Authorization header
<PROJECT_ROOT>/.creds/userid          ← plain UUIDv4 string for request bodies
```

Read both directly. If either is missing or empty, **stop immediately** and tell the user:

> Workspace credentials not found at `<PROJECT_ROOT>/.creds/`. Run `banner-blast init` (or `banner-admin init`) to provision them.

(The `.creds/userid` file is a single-line UUID — no JSON parsing. If you read whitespace, trim it.)

Set the constants:

```
API_BASE = "https://gateway.broadbanner.com/v1"
AUTH_HDR = "Authorization: Bearer ${GATEWAY_TOKEN}"
USER_ID  = <contents of .creds/userid, trimmed>
```

**Do not** read from `~/.broadbanner/`, do not look for `.env.json`, do not attempt HMAC signing. Gateway-only.

**Fail-fast rule:** Steps 0 and 0.5 both complete before any browser work begins. A successful Substack post followed by a failed ingest is worse than catching the credential problem upfront.

---

## Branch: detect note type

| Signal                                                              | Branch                   |
| ------------------------------------------------------------------- | ------------------------ |
| "image note", "post this image", file path or URL alongside caption | Image Note (Steps A1–A5) |
| "post this note", text only, no image reference                     | Text Note (Steps 1–7)    |

When ambiguous: ask once — "Is this text-only, or do you want to include an image?"

---

## IMAGE NOTE PATH (Steps A1–A5)

Image notes skip Substack entirely. The skill uploads bytes to R2 via `POST /v1/posts/media`, then ingests a tracker via `POST /v1/posts`.

### Step A1: Confirm caption, image, and pod

Resolve the pod:

1. If the user tagged a pod explicitly → use that pod ID.
2. Else if `user.defaultNotePodByBrand[BRAND_SLUG]` is set in config → use that.
3. Else fetch the user's authorized pods: `GET ${API_BASE}/me` with `${AUTH_HDR}` → `.pods`. Show the list, ask the user to pick. Store as `POD_ID`.

Show confirmation:

```
I'll queue this as an image note for Bluesky and Threads (Substack skipped):

Caption:  {caption text}
Image:    {filename or URL}
Alt text: {alt text or "(none — recommended to add one)"}
Pod:      {pod id}

Ready to queue?
```

### Step A2: Materialize the image bytes locally

Produce `IMAGE_PATH` and `IMAGE_MIME`:

- Local file → detect MIME via `file --mime-type -b <path>`.
- HTTPS URL → `curl -sSL -o /tmp/<basename> <url>`, detect MIME.

Validate: MIME must be `image/jpeg`, `image/png`, `image/gif`, or `image/webp`. Size must be ≤ 5 MB. Fail loud on violations.

### Step A3: Upload to R2 via `POST /v1/posts/media`

```bash
curl -sS -X POST "${API_BASE}/posts/media" \
  -H "${AUTH_HDR}" \
  -F "uuid=${USER_ID}" \
  -F "seriesId=${POD_ID}" \
  -F "mediaType=image" \
  -F "file=@${IMAGE_PATH};type=${IMAGE_MIME}"
```

Response (201): `{ "r2Key": "...", "publicUrl": "...", "size": ... }`

Retry policy: 5xx up to 3 attempts with 500ms → 1s → 2s backoff. The cap-token is reused as-is — no re-signing. 4xx → fail loud, surface the body.

### Step A4: Ingest via `POST /v1/posts`

```bash
TRACKER_ID="$(date -u +%Y%m%d-%H%M%S)_substack-note"

BODY_JSON=$(jq -n \
  --arg uuid "$USER_ID" \
  --arg id   "$TRACKER_ID" \
  --arg ts   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg text "$CAPTION" \
  --arg alt  "$ALT_TEXT" \
  --arg key  "$R2_KEY" \
  '{
     uuid: $uuid,
     tracker: {
       id: $id,
       source: "substack-note",
       created_at: $ts,
       text: $text,
       image: ({ r2_key: $key } + (if $alt == "" then {} else { alt: $alt } end)),
       platforms: {
         substack: { status: "skipped", skipped_reason: "image-notes-not-posted" },
         bluesky:  { status: "pending" },
         threads:  { status: "pending" }
       }
     }
   }')

curl -sS -X POST "${API_BASE}/posts" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  --data "$BODY_JSON"
```

`TRACKER_ID` must match `^[a-zA-Z0-9_-]{1,128}$` — the format above complies. Same retry policy as A3. Response (202): `{ "requestId": "...", "trackerId": "...", "scheduled": { ... } }`.

### Step A5: Report

```
Image note queued
Tracker ID: {TRACKER_ID}
Request ID: {REQUEST_ID}

  Substack: skipped
  Bluesky:  scheduled for {BLUESKY_AT}
  Threads:  scheduled for {THREADS_AT}
```

No local files written. Worker KV is the system of record.

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

### Step 1.5: Select the correct Chrome profile

Resolve the target profile from `chromeProfiles.byBrand[BRAND_SLUG]` (captured in Step 0). Pod overrides take precedence if the user tagged a specific pod (`chromeProfiles.bySeriesId[pod_id]`).

```
list_connected_browsers → find entry where name === <target profile>
select_browser({ deviceId: <matching deviceId> })
```

Skip if the current browser already matches. If no connected browser matches, **stop and tell the user** — posting under the wrong account is a public mistake. Suggest pairing the missing profile via `switch_browser`.

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

### Step 6: Ingest the tracker via gateway

Navigate to `https://gateway.broadbanner.com` in the **same tab** (same-origin requirement for fetch), then run a single `javascript_tool` call:

```javascript
const body = JSON.stringify({
  uuid: "<USER_ID>",
  tracker: {
    id: "<TRACKER_ID>",
    source: "substack-note",
    created_at: "<ISO_TIMESTAMP>",
    text: "<NOTE_TEXT>",
    platforms: {
      substack: { status: "posted", posted_at: "<ISO_TIMESTAMP>" },
      bluesky: { status: "pending" },
      threads: { status: "pending" },
    },
  },
});

const resp = await fetch("/v1/posts", {
  method: "POST",
  headers: {
    Authorization: "Bearer <GATEWAY_TOKEN>",
    "Content-Type": "application/json",
  },
  body,
});

const data = await resp.json();
JSON.stringify({ status: resp.status, data });
```

Replace all `<PLACEHOLDERS>` with values read in Steps 0 / 0.5.

`TRACKER_ID` format: `YYYYMMDD-HHMMSS_substack-note` (UTC). Must match `^[a-zA-Z0-9_-]{1,128}$`. The `text` field is the exact posted text — no trailing space, no URL-detection space from Step 4b.

**Response (202):**

```json
{
  "requestId": "<uuid>",
  "trackerId": "20260515-193122_substack-note",
  "scheduled": {
    "bluesky": { "releaseAt": "...", "delaySeconds": 75 },
    "threads": { "releaseAt": "...", "delaySeconds": 435 }
  }
}
```

**Retry policy:** if status is 5xx, retry up to 3 times with 500ms → 1s → 2s backoff. The gateway token is reused as-is. If 4xx, fail loud — surface the response body (most likely a malformed `tracker.id` or a missing field). **Do not fall back to HMAC.** If the gateway is persistently down, report:

> Gateway at gateway.broadbanner.com returned {status}. The Substack post succeeded but ingest failed — the tracker will need to be ingested manually once the gateway is back.

### Step 7: Clean up and report

Close all tabs in the MCP group: `tabs_context_mcp` → `tabs_close_mcp` for each tab.

Report:

```
Note posted to Substack
Tracker ID: {TRACKER_ID}
Request ID: {REQUEST_ID}

  Substack: posted
  Bluesky:  scheduled for {BLUESKY_AT}
  Threads:  scheduled for {THREADS_AT}
```

Worker KV is the system of record. No local tracker files are written.

Note on latency: typical ingest→posted is 1–15 minutes on Bluesky, with Threads following 5–15 seconds later. If the user wants real-time confirmation, point them at Bluesky / Threads directly.

---

## Error handling

### Critical rules

- **Never retry the Post button.** If verification is ambiguous, check the profile before any retry.
- **Anti-duplicate guard applies to ALL retries.** Before reopening the composer, re-entering text, or re-attempting Post, check the profile first.
- **Modal disappearing unexpectedly** means the window was not resized to 1200×900 in Step 2.
- **Gateway down after successful Substack post:** do NOT re-post on Substack. Report the ingest failure separately.
- **Gateway 4xx on ingest:** do NOT retry. Surface the body — it indicates a malformed tracker.

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

| Phase               | Target turns | Notes                                                                       |
| ------------------- | ------------ | --------------------------------------------------------------------------- |
| Setup + credentials | 2–3          | Direct Read of config + `.creds/gateway.token` from known mounted workspace |
| Browser posting     | 8–12         | Navigate + baseline, open composer, JS insert, JS post                      |
| Verification        | 2–4          | Reload + JS check on same page                                              |
| Ingest              | 3–5          | Navigate to gateway, single fetch call                                      |
| Cleanup + report    | 2–3          | Close tabs, format report                                                   |

If a run exceeds 50 turns, something went wrong. Surface which phase ballooned.

---

## See also

- `references/js-verification.md` — deep dive on ProseMirror text-entry and Post-button verification.
- `references/error-handling.md` — extended failure modes and recovery paths.

(The legacy `references/bb-distro-auth.md` was removed in the gateway-only cutover. There is no HMAC path in this skill any longer.)
