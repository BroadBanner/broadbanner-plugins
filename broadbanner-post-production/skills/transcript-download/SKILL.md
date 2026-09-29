---
name: transcript-download
description: "Capture a Substack live/podcast transcript via browser automation and store it in BroadBanner (D1) with the connector's save_transcript tool, deriving the episode slug, title, and date FROM THE DRAFT ITSELF. Use when the user provides a Substack draft URL for post-production, says 'download the transcript', 'grab the .txt', or 'process this live'. Captures the .txt text IN-PAGE — no ~/Downloads, no local files — so it works in local and remote Cowork. Second step of the post-production chain (after section-select). Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Transcript Download

Capture a Substack video/podcast transcript via browser automation and **store it in
BroadBanner (D1)** with the connector's `save_transcript` tool, **deriving the episode
slug, title, and date from the draft itself** — the post's own title and publish/schedule
date. There is no local `broadbanner.config.json` or `pod-map.json` naming lookup; the
draft is the source of truth for identity.

This automates the same clicks a human makes in the Substack editor (it does not hit
Substack's fragile API endpoints). It only acquires and stores the raw transcript — it
does not correct it, generate a review, or publish anything.

> **No local files — works local or remote.** The old flow clicked **Download .txt** and
> then looked for the file in `~/Downloads`. In a **remote (cloud) Cowork environment** the
> browser's download never lands anywhere the agent can read, and `/tmp` doesn't survive
> into the next session — the most common post-production failure. This skill instead
> captures the `.txt` **text in-page** (the browser hands it to the agent directly) and
> stores it in D1. Every later step — and any resumed run in a new session — reads it back
> with `get_transcript`. The member can download it from the article page in the portal.

> **Section first.** On multi-section publications the draft should already be filed under
> its series section (`section-select`, the orchestrator's Step 1) before you download.
> If you land on the editor standalone and the toolbar reads `Choose a section`, run
> `../section-select/SKILL.md` first — it needs the same resolved `seriesTitle`.

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: post_production_distribution`. Before any
browser work, call `get_creator_context` and, if it returns a capability summary
(`entitledTools` / `caps` / `tier` / `isAdmin`), confirm the caller holds the add-on
(`post_production_distribution` ∈ `entitledTools`, or `isAdmin`). If those fields are
present and the entitlement is absent, stop with the CTA below. If the context omits the
fields (older connector), proceed — the downstream connector tools fail closed as the
backstop. When invoked by the `post-production` orchestrator, this check has already run —
don't repeat it.

> ⚠️ Post-production is the **Production+** add-on (`post_production_distribution`, $5/mo).
> Your account isn't entitled yet — add it from your member portal →
> https://app.broadbanner.com/pricing/membership. Nothing was downloaded.

## Inputs

| Input                         | Required | Example                                                  | Notes                                                                 |
| ----------------------------- | -------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `draftUrl`                    | Yes      | `https://sickofthis.substack.com/publish/post/192891809` | The Substack draft editor URL for the just-finished live             |
| Resolved series context       | Yes      | `{ seriesId, seriesTitle, brandId, showId }`             | From the orchestrator's Step 0 (`get_show_roster`). Used only for staging path + reporting; NOT for slug/title/date. |

**Do not ask for an episode number, short title, season/book number, or date.** They are
derived from the draft in Step 4. If invoked standalone with only a URL and series name,
run the orchestrator's Step 0 resolution first (or accept the passed-in resolved context).

## Single browser profile

All BroadBanner Substack browser skills run from the **single** connected Chrome profile
(profile routing was retired 2026-07-27). Use whatever BroadBanner browser is currently
connected — do not switch profiles. The operator must be logged into Substack in that
browser.

## Step-by-step workflow

### Step 1: Navigate to the Substack draft

1. Open `draftUrl` in Chrome using `navigate`.
2. Wait for the page to load; `read_page` (or screenshot) to confirm you're on the Substack
   **post editor** (not a login wall, not the public post).

If a login screen appears, stop and tell the user to log into Substack first.

### Step 2: Capture the post title (for slug/title/date derivation)

Before touching the transcript panel, `read_page` the editor and capture:

- The **post title** as shown in the editor's title field (e.g.
  `Palantalk | E12 - Surveillance Capitalism and You`).
- The post's **date** — read the scheduled/publish date shown in the editor (the
  publish-settings or the "Scheduled for …" / "Published on …" label). If the editor shows
  no date (unscheduled draft), fall back to **today's date**.

Hold both — Step 4 derives the episode identity from them.

### Step 3: Capture the transcript text in-page

Open the transcript panel:

1. Find and click the scissors / media-editing icon in the editor toolbar (near the video
   player controls). The **Media settings** panel opens on the right.
2. In that panel, click the **Transcript** tab (in the `Settings | Transcript | Clips`
   tab bar). Wait for the timestamped speaker segments to load.

**3a. Arm the capture hook** — run this with `javascript_tool` in the editor tab **before**
clicking Download. It intercepts the file Substack builds for the download (a `Blob` via
`URL.createObjectURL`, or a `data:` / same-origin URL on an `<a download>` click) and keeps
the text on `window.__bbTranscript` instead of relying on the saved file:

```js
(() => {
  window.__bbTranscript = null;
  const keep = (t) => { if (typeof t === "string" && t.trim() && !window.__bbTranscript) window.__bbTranscript = t; };
  const fromUrl = (href) => {
    if (!href) return;
    if (href.startsWith("data:")) {
      const [meta, body] = href.split(",", 2);
      keep(meta.includes(";base64") ? new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0))) : decodeURIComponent(body));
    } else if (!href.startsWith("blob:")) {
      fetch(href, { credentials: "include" }).then(r => r.ok ? r.text() : null).then(keep).catch(() => {});
    }
  };
  if (!window.__bbHooked) {
    window.__bbHooked = true;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      if (obj instanceof Blob) obj.text().then(keep).catch(() => {});
      return origCreate.apply(this, arguments);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) fromUrl(this.href);
      return origClick.apply(this, arguments);
    };
  }
  return "armed";
})()
```

**3b. Trigger the download.** Click the **…** (overflow) button in the transcript toolbar
row (alongside `Regenerate` / `Upload transcript`), then click **Download .txt**.

**3c. Confirm the capture.** Poll (every 1s, up to ~15s):

```js
JSON.stringify({ chars: window.__bbTranscript ? window.__bbTranscript.length : 0,
                 head: window.__bbTranscript ? window.__bbTranscript.slice(0, 300) : null })
```

Ready when `chars > 0` and `head` looks like timestamped speaker text. If it never fills,
use the **DOM fallback** below. (If the browser also saved the file to Downloads, ignore
it — nothing reads it.)

**DOM fallback (only if the hook captured nothing).** Read the segments straight out of the
open Transcript tab: scroll the segment list to the bottom (it may render lazily), then
collect each segment's timestamp, speaker label, and text in order into
`window.__bbTranscript`, one segment per line (`<timestamp> <speaker>: <text>`). Confirm
the line count looks like a full show (hundreds of lines for an hour), not just the
visible screen. If neither path yields text, stop and report — do **not** fabricate a
transcript.

**3d. Pull the text into the conversation in chunks.** A single tool result can't carry a
whole transcript reliably, so read it in 30,000-character slices:

```js
window.__bbTranscript.slice(OFFSET, OFFSET + 30000)
```

starting at `OFFSET = 0` and advancing by 30,000 until you've read `chars` characters.
Keep the slices exactly as returned — they're concatenated verbatim in Step 5.

### Step 4: Derive episode identity from the draft

From the captured post title and date, derive:

- **`episodeTitle`** — the full post title, verbatim (e.g.
  `Palantalk | E12 - Surveillance Capitalism and You`). This is what downstream review
  generation displays.
- **`episodeSlug`** — a kebab-case slug built from the post title:
  1. If the title has a `Series | E<N> - <Short Title>` shape, take the part **after the
     dash** as the short title; keep the `E<N>` if present.
  2. Lowercase, replace spaces with hyphens, strip punctuation, collapse repeats.
  3. Keep the first ~6 meaningful words. Prefix the episode marker if present
     (e.g. `e12-surveillance-capitalism-and-you`). For a title with no `E<N>` marker,
     the slug is just the kebab-cased short title (e.g. `surveillance-capitalism-and-you`).
  This mirrors the old episodic-mode slugging — but sourced from the post, not a config
  `seasonBookMode`.
- **`episodeDate`** — the date captured in Step 2, normalized to `YYYY-MM-DD`.

> The draft is authoritative. Do **not** reconstruct the slug from a series prefix or a
> local naming template. If the title is empty or unparseable, ask the operator for a
> short title rather than guessing.

### Step 5: Store the raw transcript in BroadBanner (D1)

Save the raw text with the connector's **`save_transcript`** tool, keyed by the resolved
series and the derived slug. Send the chunks from Step 3d **in order**:

```
save_transcript({
  seriesId:     "<seriesId>",          // from Step 0 resolution
  episodeSlug:  "<episodeSlug>",       // Step 4
  showId:       "<showId>",            // if resolved; omit otherwise
  episodeTitle: "<episodeTitle>",
  episodeDate:  "<episodeDate>",
  sourceUrl:    "<draftUrl>",
  rawText:      "<chunk 1>"            // first call: no append → replaces
})
save_transcript({ seriesId, episodeSlug, rawText: "<chunk 2>", append: true })
…                                      // one call per remaining chunk
```

- The first call **replaces** any raw text stored for this episode (a re-run starts
  clean); each `append: true` call concatenates exactly — no separator is added, so pass
  each slice unmodified.
- **Verify:** the last result's `transcript.rawChars` must equal the captured `chars`
  from Step 3c. If it doesn't, re-send from the first chunk (without `append`).
- Keep the returned `transcript.id` as **`transcriptId`**.
- A `403 you don't host this series` means the resolved series isn't one this creator
  hosts — stop and re-check Step 0 rather than retrying.

You may *also* keep a working copy on disk (e.g. `/tmp/post-production/<seriesId>_<episodeSlug>.txt`)
for the correction script — but D1 is the source of truth; nothing downstream may depend
on that file existing.

### Step 6: Report and hand off

Report:

- The `transcriptId` and that the raw transcript is stored (`rawChars` characters)
- The derived `episodeSlug`, `episodeTitle`, and `episodeDate`
- Line count of the captured text

Then: "Transcript stored. Next: transcript-correction (against the live roster)."

**Carries forward:** `transcriptId`, `episodeSlug`, `episodeTitle`, `episodeDate`, raw
line count (and the raw text itself, already in context).

## Error handling

- **Scissors/transcript icon not found:** the video may not have finished processing, or
  the layout changed. Screenshot and ask the user for guidance.
- **Transcript tab shows "no transcript":** auto-transcription isn't complete — tell the
  user to wait or use **Regenerate**, then retry.
- **Capture hook stays empty:** re-arm the hook (Step 3a) and click **Download .txt**
  again; then use the DOM fallback. If both fail in an attended run, the user may paste
  the transcript text or upload the `.txt` into the conversation — store it with
  `save_transcript` the same way. Never look for the file in `~/Downloads`.
- **`save_transcript` fails:** transient/5xx → retry the same chunk up to 3× with backoff;
  `413` → the transcript exceeds the ~900 KB cap (report it); `403` → the creator doesn't
  host the resolved series (re-check Step 0).
- **Wrong page / login required:** stop immediately, explain, and ask the user to log in
  or navigate to the correct draft.
- **Title empty/unparseable:** ask the operator for a short title for the slug — do not
  fabricate an episode identity.

## URL structure reference

Substack URLs follow two patterns:

- **Draft posts:** `https://<subdomain>.substack.com/publish/post/<numeric-id>`
- **Published posts:** `https://<subdomain>.substack.com/p/<slug>`

Either works — the transcript panel is the same in both. The subdomain is informational
only; series identity comes from the orchestrator's connector resolution, not the URL.
