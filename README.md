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

Then install `broadbanner-social-distribution` + `broadbanner-scheduling` from
that marketplace, and manage/update them from the same "Personalize Plugins" panel.

**Claude Code (CLI)** — slash commands work:

```
/plugin marketplace add BroadBanner/broadbanner-plugins
/plugin install broadbanner-social-distribution@broadbanner
```

To update later in Claude Code: `/plugin marketplace update broadbanner`.

## Plugins

- `broadbanner-episode-pipeline` — End-to-end episode processing for Banner and Backbone Media. Orchestrates section selection, transcript download, transcript correction, episode review generation, and Pages publishing from a single Substack post URL.
- `broadbanner-restream` — Restream workflow automation for Banner and Backbone Media. Schedule live stream events in Restream Studio and publish clips to TikTok, YouTube, and Facebook via the Restream clips UI.
- `broadbanner-scheduling` — Scheduled-task management for BroadBanner Cowork projects. Registers declarative scheduled-task specs (cron or one-time) into the Cowork scheduler from a project's .broadbanner/scheduled-tasks/ directory, filed under the project the skill is run from. Reusable across brands and expandable to any custom scheduled skill.
- `broadbanner-social-distribution` — Social media distribution toolkit for Banner and Backbone Media. Post text or image notes to Substack/Bluesky/Threads, schedule Substack and Restream live streams, track cross-platform distribution status, and manage social publishing workflows.

---

> **Auto-generated.** This repo is synced from the private source on each release —
> do not edit it directly; changes here will be overwritten.
