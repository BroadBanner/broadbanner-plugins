---
name: release-substack-text
description: "Release queued text Notes to Substack. Uses the BroadBanner MCP connector to list the creator's pending text posts (from the BannerBlast web composer), posts each to Substack via browser automation, and marks it released — no local credentials or config. Runs unattended on a schedule. Triggers on 'release my Substack posts' / 'post my pending notes', or the scheduled release task. Reuses substack-note's browser posting; the existing tracker is marked posted, not re-ingested."
---

# Release Substack Text Posts

A background, **unattended** skill: pull the creator's text posts waiting to go out
on Substack, post each as a Note via browser automation, and mark it released.

This is the consumer half of the web text-post flow. The BannerBlast web composer
(`#blastItButton`) ingests a tracker with `substack: pending` (plus `bluesky` /
`threads`, which the Worker queue posts via API). The Worker queue **never** posts
Substack — there's no API — so those notes sit `pending` until this skill releases
them through the browser.

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
`{ posts: [ { id, text, created_at } ] }` for the signed-in creator.

- **If `posts` is empty → exit immediately** with a one-line "nothing pending" report.
  Do **not** open a browser. This is the common, cheap path.

Otherwise, sort `posts` oldest-first by `created_at`. Cap this run at **5** — process the
oldest 5 and note any remainder goes out next run.

---

## Step 2: Resolve the Substack account + select the browser

Call **`get_creator_context`** → `{ substackHandle, brand, brands, pods, ... }`. You need
`substackHandle` (e.g. `nickparo`) — that's the Substack account these notes post to.

Substack posting is browser automation (Option A — a local logged-in browser). There is
**no brand→profile config**; the account is identified by `substackHandle`:

1. `list_connected_browsers`. If none are connected → **stop and report** (no browser to drive).
2. Select a connected browser; `navigate` to `https://substack.com/@{substackHandle}` and
   `resize_window` to **1200×900**.
3. **Verify you are logged in as `{substackHandle}`** (the profile page shows that account).
   - Wrong account, or a login screen → **stop and tell the user** to log into
     `{substackHandle}`'s Substack in the browser Cowork drives. Posting under the wrong
     identity is a public mistake — never guess across profiles.
   - (Multiple connected browsers? Pick the one logged into `{substackHandle}`. A creator
     with several distinct Substack accounts is an edge case — handle the one matching
     `substackHandle` and flag the rest.)

---

## Step 3: For each pending post — post to Substack, then mark released

Process posts **one at a time**. For each `{ id, text }`:

### 3a. Post the text to Substack (browser)

Reuse substack-note's TEXT NOTE path exactly — see `../substack-note/SKILL.md` Steps 2–5b
and `../substack-note/references/js-verification.md`. Load-bearing steps:

1. On `https://substack.com/@{substackHandle}` (window 1200×900), capture the baseline
   top-note text.
2. Click "What's on your mind?" in the notes body (not the nav bar). Verify the
   `[role="dialog"]` modal + `.ProseMirror` editor opened.
3. Enter the text with **JavaScript** (never the `type` action):
   `document.execCommand("insertText", false, \`<text>\`)` — backtick template so line
   breaks / em dashes / curly quotes survive. Confirm `editorText` is non-empty and the
   Post button is enabled.
4. **Click Post exactly once**, then immediately `postBtn.disabled = true` AND
   `postBtn.style.pointerEvents = "none"`. Never click Post twice.
5. Wait 6s, reload the tab, verify the note appears (baseline changed OR the first 60
   chars are present).

**ANTI-DUPLICATE GUARD:** before any retry, re-check the profile — a post may have
succeeded even if the modal misbehaved. Never re-click Post on an ambiguous result.

### 3b. Mark released (MCP tool)

- **On success:** call **`mark_substack_posted`** with `{ trackerId: "<id>", status: "posted" }`.
- **On failure** (post never confirmed, *after* the anti-duplicate profile re-check): call
  **`mark_substack_posted`** with `{ trackerId: "<id>", status: "failed", error: "<short reason>" }`
  so it isn't retried forever.

Then proceed to the next post. The browser stays selected across iterations.

---

## Step 4: Clean up and report

Close all MCP tabs (`tabs_context_mcp` → `tabs_close_mcp`). Report:

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
  browser/login), stop and report; don't ask and wait.
- **Never click Post more than once.** Verify against the profile before any retry.
- **Window must be 1200×900** or the composer modal dismisses.
- **Empty queue is normal** — fast-exit without touching Substack.
- **Missing tools = connector not connected.** Do NOT fall back to `.creds/` or the CLI.
- **One post at a time.** Post → mark → next. Never batch the browser posts.

## See also

- `../substack-note/SKILL.md` — the browser-posting steps (Steps 2–5b).
- `../substack-note/references/js-verification.md` — ProseMirror text-entry + Post-button verification.
- `../substack-note/references/error-handling.md` — extended failure modes.
