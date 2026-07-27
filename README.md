# BroadBanner Plugins

Public **distribution mirror** of the BroadBanner Cowork plugins. The source of
truth is a private repository; this repo holds the built, install-ready plugins.
Skills are instructions only — **no secrets** (signing keys, tokens, app secrets,
and the org passphrase all live in Workers / Wix Secrets, never in a SKILL.md).

## Install

**Claude Cowork (desktop app)** — the `/plugin …` slash commands do **not** work
here; add the marketplace through the UI. In the Cowork section:

> Customize → the **+** next to "Personalize Plugins" → Create plugin → Add
> marketplace → Add from a repository → `BroadBanner/broadbanner-plugins`

Then install `broadbanner-social-distribution` + `broadbanner-scheduled-tasks` from
that marketplace, and manage/update them from the same "Personalize Plugins" panel.

**Claude Code (CLI)** — slash commands work:

```
/plugin marketplace add BroadBanner/broadbanner-plugins
/plugin install broadbanner-social-distribution@broadbanner
```

To update later in Claude Code: `/plugin marketplace update broadbanner`.

## Plugins

- `broadbanner-episode-pipeline` — End-to-end episode processing for Banner and Backbone Media. Orchestrates section selection, transcript download, transcript correction, episode review generation, and Pages publishing from a single Substack post URL.
- `broadbanner-live-production` — Creator+ live-production automation for Banner and Backbone Media. Schedule Substack and Restream live streams for the series you host, and publish clips to TikTok, YouTube, and Facebook via the Restream clips UI. Maps to the creator_workspace entitlement (Creator+).
- `broadbanner-pre-production` — Pre-Production Assistant (Production+ add-on) for Banner and Backbone Media. Auto-schedules your shows on Substack and Restream on a recurring basis — the unattended automation of the manual schedule-live skills. Maps to the pre_production_assistant entitlement (cap scheduling:auto). Installs its recurring tasks through the broadbanner-scheduled-tasks engine.
- `broadbanner-scheduled-tasks` — The scheduled-task engine for BroadBanner Cowork projects. The `bb-scheduled-manager` skill installs, updates, or uninstalls declarative scheduled-task specs (cron or one-time) in the Cowork scheduler from a project's .broadbanner/scheduled-tasks/ directory, filed under the project it's run from. Generic and reusable — tier plugins supply their own task templates via --templates-dir. Renamed from broadbanner-scheduling.
- `broadbanner-social-distribution` — Social posting toolkit for Banner and Backbone Media (Core tier / banner_blast). Post text, image, and video notes to Substack/Bluesky/Threads and release queued Substack notes and clips. Runs on a single connected Chrome profile. Live-stream scheduling moved to the broadbanner-live-production plugin.

---

> **Auto-generated.** This repo is synced from the private source on each release —
> do not edit it directly; changes here will be overwritten.
