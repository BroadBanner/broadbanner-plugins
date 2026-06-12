# BroadBanner Social Media Distribution Plugin

Social media distribution toolkit for **Banner and Backbone Media**. Automates posting to social platforms and tracks cross-platform distribution status.

## Skills

| Skill                      | Auth path                | What it does                                                                                                                   |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `substack-note`            | Gateway-only             | Post a text Note to Substack via browser automation, or queue an image note for Bluesky/Threads. Worker KV is SoT.             |
| `substack-schedule-live`   | Gateway-only             | Schedule upcoming live streams in the Substack publisher dashboard; PATCH stream credentials back to D1 via the Gateway.       |
| `substack-video-note`      | Local-only / technique ref | Post a Substack Note with a video clip via browser automation (fetches the clip from R2 in-page). Interactively reads/updates a tracker JSON; also the **browser-technique reference** reused by `release-substack-clips`. |
| `release-substack-text`    | MCP connector (+ browser) | **Consumer (text).** Scheduled poller for web-composed text posts: calls the **BroadBanner MCP connector** (`list_pending_substack` / `get_creator_context` / `mark_substack_posted`) — **no local creds or config** — and posts each as a Substack Note via browser automation (reuses substack-note). Substack-only; Bluesky/Threads go via the Worker queue. Single self-contained task. |
| `release-substack-clips`   | MCP connector (+ browser) | **Consumer (clips).** Scheduled poller for video clips — the MCP successor to the old `refill-clip-queue` + `drain-clip-queue` pair. Calls the connector (`list_pending_clips` / `get_creator_context` / `mark_substack_posted`) — **no local creds, config, or local queue** — and posts each clip as a Substack video Note (reuses substack-video-note's in-page R2 fetch + inject). Substack-only; caps 2/run. |

> Restream scheduling (`restream-schedule-live`) lives in the sibling plugin **`broadbanner-restream`**, not here. It's Gateway-only as of the 2026-05-21 cutover.

## How it works (substack-note)

1. You tell Claude to post a note (e.g., "post this to Substack").
2. Claude confirms the text with you, then automates the browser to post it.
3. The skill ingests a tracker into the BannerBlast Distribution Worker via the Gateway BFF (`https://gateway.broadbanner.com/v1/posts`) with Substack marked `posted` and Bluesky/Threads `pending`.
4. The Worker handles cross-posting to Bluesky and Threads on a staggered schedule. The Worker's KV record is the system of record; no local tracker JSON is written by this skill.

## Requirements

- An authenticated Substack session in your browser (none of the skills automate login).
- Claude in Chrome extension (for browser automation).
- A BroadBanner workspace initialized with `banner-blast init` (or `banner-admin init`), which provisions:
  - `<PROJECT_ROOT>/broadbanner.config.json`
  - `<PROJECT_ROOT>/.creds/gateway.token` (mode 0700) — the capability token the skills use for all Gateway calls.
- For `substack-schedule-live`: admin-tier cap-token (`is_admin === 1` in D1.contributors), which auto-claims `shows:read`, `shows:write`, `restream:read`, `restream:write` from `@broadbanner/core` 1.16.0+.

## Distribution tracker schema (substack-note request body)

The substack-note skill sends this JSON to `POST https://gateway.broadbanner.com/v1/posts` (cap-token bearer). The Worker persists it in KV — no local file is written by this skill.

```json
{
  "uuid": "<USER_ID>",
  "tracker": {
    "id": "<timestamp>_substack-note",
    "source": "substack-note",
    "created_at": "ISO 8601",
    "text": "the posted text",
    "platforms": {
      "substack": { "status": "posted", "posted_at": "ISO 8601" },
      "bluesky":  { "status": "pending" },
      "threads":  { "status": "pending" }
    }
  }
}
```

Interactively, `substack-video-note` updates an existing JSON file under `Social-Distribution/` in-place. The scheduled clip flow, however, is **`release-substack-clips`**: it pulls the creator's pending clips from Worker KV through the **MCP connector** (`list_pending_clips` → the Gateway's `/v1/creators/pending-clips`) and marks each released via `mark_substack_posted` — no local queue file. KV stays the SoT; the clip video is never copied locally (it's fetched from R2 in-page at post time). This MCP path replaced the old `refill-clip-queue` (producer) + `drain-clip-queue` (consumer) local-queue pair, which existed only because Cowork bash has no network.

## For the production team

This plugin is installed via Cowork. Updates are published automatically when changes are pushed to the `main` branch of the BroadBanner repo. You don't need to do anything to stay current — the plugin syncs via CI.

## Evaluation

The `substack-note` skill includes an eval suite in `skills/substack-note/evals/evals.json`. Evals require a live authenticated Substack session and must be run manually (not via parallel subagents). See the eval file for test cases and results.

## Self-contained resources

This plugin ships with all reference files it needs — no external source directories or CLI repos required (the legacy `BroadBanner/Skills/` and `BroadBanner/CLI-Assistant/` sources are retired):

- **Skill instructions** — each skill under `skills/` includes its own SKILL.md, error-handling references, and JS verification snippets
- **Gateway-auth reference** — `skills/substack-schedule-live/references/gateway-auth.md` covers cap-token usage for the shows endpoints

Runtime working directories (`Social-Distribution/`) remain in the host BroadBanner tree. Live show data is fetched at runtime from the BroadBanner Gateway (`https://gateway.broadbanner.com/v1/shows`, D1-backed via Service Binding to the Data Worker); the deprecated local `wix-latest.json` written by `banner-admin wix-poller` is no longer the source of truth, and skills no longer hit `data.broadbanner.com` directly.

## Development

Source of truth for skill logic is **this directory** — `Plugins/broadbanner-social-distribution/skills/<skill-name>/SKILL.md`. Edit files here directly and push to `main`. The previously-used `BroadBanner/Skills/` directory and `scripts/sync-from-source.sh` bridge are retired and the script is preserved only as a historical reference (it errors out if run).

The plugin is built from this source via GitHub Actions. The CI workflow:

1. Detects changes to skill files
2. Rebuilds the `.plugin` zip
3. Creates a GitHub release with the new version

To add a new skill to this plugin, create a new directory under `skills/` with a `SKILL.md` following the same frontmatter format.
