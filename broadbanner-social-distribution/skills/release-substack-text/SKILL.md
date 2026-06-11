---
name: release-substack-text
description: "Release queued text Notes to Substack. Polls the Gateway for the creator's text posts whose Substack slot is still pending (from the BannerBlast web composer), posts each via browser automation, and marks it released. Gateway-only auth, no HMAC. Runs unattended on a schedule. Triggers on 'release my Substack posts' / 'post my pending notes', or the scheduled release task. Reuses substack-note's browser posting, but the text comes from the queue (not the user) and the existing tracker is marked posted, not re-ingested."
---

# Release Substack Text Posts

A background, **unattended** skill: pull the creator's text posts that are waiting
to go out on Substack, post each one as a Note via browser automation, and mark
it released on the hosted system.

This is the consumer half of the web text-post flow. The BannerBlast web composer
(`#blastItButton`) ingests a tracker with `substack: pending` (plus `bluesky` /
`threads`, which the Worker queue posts via API). The Worker queue **never** posts
Substack — there's no API — so those notes sit `pending` until this skill releases
them through the browser.

It reuses **substack-note**'s proven browser posting. The only differences:

- **Input** comes from the queue (`GET /v1/creators/pending-substack`), not the user.
- **No confirmation** — this runs on a schedule. Post what's pending.
- **Finish** marks the existing tracker (`POST /v1/creators/mark-substack`) instead
  of ingesting a new one.

Auth is **gateway-only**: a capability-token Bearer against `gateway.broadbanner.com`.
No HMAC fallback. Identity is taken from the token itself — these endpoints resolve
the creator from the token subject, so **no `USER_ID` is needed**.

---

## Step 0: Discover the project and read config

Identical to substack-note Step 0. From the workspaces the Cowork dispatch
enumerated in the system prompt (do **not** glob `/sessions/*/mnt/*/`), Read each
candidate's `<workspace>/broadbanner.config.json`:

- Zero hits → `mcp__cowork__request_cowork_directory`, ask for the BroadBanner folder, retry.
- One hit → use it.
- Multiple hits → list them, ask which to use. (Unattended runs are pinned to a
  single workspace by the scheduled-task spec, so this should be unambiguous.)

Capture:

| Variable          | Source                               | Example                            |
| ----------------- | ------------------------------------ | ---------------------------------- |
| `PROJECT_ROOT`    | The mounted workspace path           | `/Users/<user>/NickParo`           |
| `SUBSTACK_HANDLE` | `user.substackUsername`              | `"nickparo"`                       |
| `BRAND_SLUG`      | `user.brandSlugs[0]`                 | `"sotsp"`                          |
| `CHROME_PROFILE`  | `chromeProfiles.byBrand[BRAND_SLUG]` | `"Sick of this Shit Publications"` |

If `user.substackUsername` is absent, stop and report (an unattended run can't prompt).

---

## Step 0.5: Load the gateway token

**One file, one Read:**

```
<PROJECT_ROOT>/.creds/gateway.token   ← cap-token Bearer for Authorization header
```

(Unlike substack-note, this skill does **not** need `.creds/userid` — the
pending-substack and mark-substack endpoints resolve the creator from the token
subject.)

If missing or empty, **stop immediately** and report:

> Workspace gateway token not found at `<PROJECT_ROOT>/.creds/gateway.token`. Run `banner-blast init` (or `banner-admin init`) to provision it.

Set:

```
GATEWAY_TOKEN = <contents of .creds/gateway.token, trimmed>
```

**Do not** read `~/.broadbanner/`, do not look for `.env.json`, do not HMAC-sign.

---

## Step 1: Poll for pending text posts (in-browser fetch)

Cowork bash has **no outbound network** — `curl`/`node fetch` to the Gateway fail.
The only way to reach the Gateway is a same-origin `javascript_tool` fetch from a
browser tab pointed at `gateway.broadbanner.com`.

In one `browser_batch`: `tabs_create_mcp` → record `tabId` → `navigate` to
`https://gateway.broadbanner.com`. Then a single `javascript_tool` call:

```javascript
const resp = await fetch("/v1/creators/pending-substack", {
  headers: { Authorization: "Bearer <GATEWAY_TOKEN>" },
});
const data = await resp.json();
JSON.stringify({ status: resp.status, data });
```

Response (200): `{ "posts": [ { "id": "...", "text": "...", "created_at": "..." }, ... ] }`

- `403 Missing capability: posts:read` → the token lacks `posts:read`. Stop; tell the
  user to re-run `banner-blast init` with the latest CLI.
- `404` → the token's identity resolves to no creator. Stop and report.
- `5xx` → retry up to 3× (500ms → 1s → 2s). Persistent → stop and report.

**If `posts` is empty → exit immediately** with a one-line "nothing pending" report.
This is the common, cheap path. Do not open any other tab.

Sort `posts` by `created_at` ascending (oldest first). Cap this run at **5** posts —
if there are more, process the oldest 5 and note the remainder will go out on the
next scheduled run.

---

## Step 2: Select the correct Chrome profile

Same as substack-note Step 1.5. Resolve the profile from
`chromeProfiles.byBrand[BRAND_SLUG]`:

```
list_connected_browsers → find entry where name === <CHROME_PROFILE>
select_browser({ deviceId: <matching deviceId> })
```

If no connected browser matches, **stop and report** — posting under the wrong
account is a public mistake. Do not guess a profile.

---

## Step 3: For each pending post — post to Substack, then mark released

Process the posts **one at a time**. For each `{ id, text }`:

### 3a. Post the text to Substack (browser)

Reuse substack-note's TEXT NOTE path exactly — see
`../substack-note/SKILL.md` Steps 2–5b and `../substack-note/references/js-verification.md`.
Summary of the load-bearing steps:

1. Navigate to `https://substack.com/@{SUBSTACK_HANDLE}`; **`resize_window` to 1200×900**
   (narrower/wider viewports dismiss the modal). Capture the baseline top-note text.
2. Click "What's on your mind?" in the notes body (not the nav bar). Verify the
   `[role="dialog"]` modal + `.ProseMirror` editor opened.
3. Enter the text with **JavaScript** (never the `type` action):
   `document.execCommand("insertText", false, \`<text>\`)`— backtick template so
line breaks / em dashes / curly quotes survive. Confirm`editorText` non-empty and
   the Post button enabled.
4. **Click Post exactly once**, then immediately `postBtn.disabled = true` AND
   `postBtn.style.pointerEvents = "none"`. Never click Post twice.
5. Wait 6s, reload the tab, verify the note appears (baseline changed OR the first
   60 chars are present).

**ANTI-DUPLICATE GUARD:** before any retry, re-check the profile — a post may have
succeeded even if the modal misbehaved. Never re-click Post on an ambiguous result.

### 3b. Mark the tracker released (in-browser fetch)

Navigate the **same tab** back to `https://gateway.broadbanner.com` (same-origin),
then one `javascript_tool` call:

**On success:**

```javascript
const resp = await fetch("/v1/creators/mark-substack", {
  method: "POST",
  headers: {
    Authorization: "Bearer <GATEWAY_TOKEN>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    trackerId: "<POST_ID>",
    status: "posted",
    posted_at: new Date().toISOString(),
  }),
});
const data = await resp.json();
JSON.stringify({ status: resp.status, data });
```

Response (200): `{ "ok": true, "trackerId": "<POST_ID>", "status": "posted" }`.

**If the browser post FAILED** (verification never confirmed), mark it failed so it
isn't retried forever — but only after the anti-duplicate profile re-check:

```javascript
body: JSON.stringify({
  trackerId: "<POST_ID>",
  status: "failed",
  error: "<short reason, e.g. composer did not confirm post>",
});
```

Retry the mark fetch up to 3× on 5xx. A `404` means the tracker vanished (TTL/edge);
log it and move on.

Then proceed to the next post (loop back to 3a). The Chrome profile stays selected
across iterations.

---

## Step 4: Clean up and report

Close all MCP tabs (`tabs_context_mcp` → `tabs_close_mcp`). Report:

```
Released N Substack post(s):
  • {POST_ID_1} — posted
  • {POST_ID_2} — posted
  • {POST_ID_3} — failed (composer did not confirm)
{M remaining — will release on the next scheduled run}   (only if capped)
```

Worker KV is the system of record. No local tracker files are written. Bluesky and
Threads for these posts are handled separately by the BannerBlast Worker queue — this
skill only touches Substack.

---

## Critical rules (same spirit as substack-note)

- **Unattended — never block on a prompt.** If something is missing (handle, token,
  profile), stop and report; don't ask and wait.
- **Never click Post more than once.** Verify against the profile before any retry.
- **Modal disappearing** = the window wasn't resized to 1200×900.
- **Empty queue is the normal case** — exit fast, cheaply, without touching Substack.
- **Gateway 4xx** (other than 404) → fail loud, surface the body; do not HMAC fall back.
- **One post at a time.** Post → mark → next. Never batch the browser posts.

## See also

- `../substack-note/SKILL.md` — the source of the browser-posting steps (Steps 2–5b).
- `../substack-note/references/js-verification.md` — ProseMirror text-entry + Post-button verification deep dive.
- `../substack-note/references/error-handling.md` — extended failure modes.
