# BroadBanner Plugins

Public **distribution mirror** of the BroadBanner Cowork plugins. The source of
truth is a private repository; this repo holds the built, install-ready plugins.
Skills are instructions only — **no secrets** (signing keys, tokens, app secrets,
and the org passphrase all live in Workers / Wix Secrets, never in a SKILL.md).

## Install (Claude Code / Cowork)

```
/plugin marketplace add BroadBanner/broadbanner-plugins
/plugin install broadbanner-social-distribution@broadbanner
```

To update later:

```
/plugin marketplace update broadbanner
```

(Org admins can enable auto-update for this marketplace via managed settings.)

## Plugins

| Plugin | What it does |
| --- | --- |
| `broadbanner-social-distribution` | Post text/image/video notes to Substack/Bluesky/Threads, release queued Substack posts, schedule live streams, track distribution. |
| `broadbanner-scheduling` | Register declarative scheduled-task specs (cron / one-time) into the Cowork scheduler. |
| `broadbanner-episode-pipeline` | End-to-end episode processing: section select, transcript download + correction, review generation, Pages publishing. |

---

> **Auto-generated.** This repo is synced from the private source on each release —
> do not edit it directly; changes here will be overwritten.
