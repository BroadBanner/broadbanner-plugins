---
name: transcript-download
description: "Download a Substack live/podcast transcript via browser automation and derive the episode slug, title, and date FROM THE DRAFT ITSELF. Use when the user provides a Substack draft URL for post-production, says 'download the transcript', 'grab the .txt', or 'process this live'. Automates the four clicks in the Substack post editor to download the transcript .txt, then slugs the episode from the post title — no local config, no manually-supplied episode id/date. First step of the post-production chain. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Transcript Download

Download a Substack video/podcast transcript via browser automation and stage it locally,
**deriving the episode slug, title, and date from the draft itself** — the post's own
title and publish/schedule date. There is no local `broadbanner.config.json` or
`pod-map.json` naming lookup; the draft is the source of truth for identity.

This automates the same four clicks a human makes in the Substack editor (it does not hit
Substack's fragile API endpoints). It only acquires and stages the `.txt` — it does not
correct the transcript, generate a review, or publish anything.

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

### Step 3: Download the transcript .txt

1. Find and click the scissors / media-editing icon in the editor toolbar (near the video
   player controls). The **Media settings** panel opens on the right.
2. In that panel, click the **Transcript** tab (in the `Settings | Transcript | Clips`
   tab bar). Wait for the timestamped speaker segments to load.
3. Click the **…** (overflow) button in the transcript toolbar row (alongside
   `Regenerate` / `Upload transcript`).
4. Click **Download .txt**. Wait for the download to complete.

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

### Step 5: Locate, verify, and stage the file

1. Find the most recently downloaded `.txt` in the Downloads folder.
2. `Read` it to confirm it contains transcript content (timestamped speaker text).
3. Stage it to a working path under the active `Social-Distribution/transcripts/` tree if
   one is available, named with the derived slug — otherwise stage it to
   `/tmp/post-production/<seriesId>_<episodeSlug>.txt`. The exact directory is not
   load-bearing for the connector-published flow; the transcript is an intermediate
   artifact consumed by the next skill, not a committed deliverable.

### Step 6: Report and hand off

Report:

- The staged `transcriptPath`
- The derived `episodeSlug`, `episodeTitle`, and `episodeDate`
- Line/character count

Then: "Transcript staged. Next: transcript-correction (against the live roster)."

**Carries forward:** `transcriptPath`, `episodeSlug`, `episodeTitle`, `episodeDate`, raw
line count.

## Error handling

- **Scissors/transcript icon not found:** the video may not have finished processing, or
  the layout changed. Screenshot and ask the user for guidance.
- **Transcript tab shows "no transcript":** auto-transcription isn't complete — tell the
  user to wait or use **Regenerate**, then retry.
- **Download doesn't start:** click **Download .txt** again; if it still fails, ask the
  user to download manually and provide the path.
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
