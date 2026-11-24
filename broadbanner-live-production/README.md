# BroadBanner Live Production Plugin

Creator+ live-production automation for **Banner and Backbone Media** — the
`creator_workspace` entitlement. Schedule Substack and Restream live streams for the
series you host, and publish clips to TikTok/YouTube/Facebook.

> Renamed from `broadbanner-restream` (2026-07). `substack-schedule-live` moved here from
> `broadbanner-social-distribution` so the Creator+ live-scheduling skills live in one
> bundle that maps to the `creator_workspace` catalog tool. If you had
> `broadbanner-restream` installed, install `broadbanner-live-production` and remove the old one.

## Skills

| Skill | Description |
|---|---|
| `substack-schedule-live` | Schedule upcoming show live streams in the Substack publisher dashboard — automates the "Go live with stream key" modal, invites co-hosts, captures stream credentials, and writes them back to D1. Connector-only (BroadBanner MCP admin tools). |
| `restream-schedule-live` | Schedule upcoming show live streams as Restream events, pairing the correct Substack channel and setting the event description. Connector-only (BroadBanner MCP admin tools). |
| `restream-publish-clip` | Publish the next Restream clip to TikTok and YouTube (and Facebook for B&B) via the Restream clips UI. The clip list comes from the connector (`list_pending_restream_clips`): only clips made after the start date, never a Manual series, one per run; the result is recorded with `mark_restream_published`. |

> **Note:** `restream-publish-clip` needs BannerBlast (`metadata.requiresTool: banner_blast`,
> connector cap `creators:write`), not `creator_workspace`. It rides here for now.

**Scheduled clip publishing.** `references/templates/restream-publish-clips.md` runs
`restream-publish-clip` hourly on this computer (it publishes only 10:00–22:59 ET, one clip
per run, so clips go out at least an hour apart). Install it with `bb-scheduled-manager`
and `--templates-dir` pointed at this plugin's `references/templates/`.

## Entitlement / authority

- `substack-schedule-live` and `restream-schedule-live` are tagged
  `metadata.requiresTool: creator_workspace` and begin with an advisory entitlement
  preflight. Today they authorize via the BroadBanner MCP connector's admin tools
  (brand-admin / super-admin role); the connector fails closed for a session without a
  scheduling role. Creator-scoped scheduling (any host of a series) is a planned backend
  change — see `Documentation/engineering/PLUGIN-TIERING-AND-ENTITLEMENT-GATING.md`.

## Secrets

Stream keys and co-host invite links are never printed: reports show `••••` + the last 4, and the
connector's `list_schedulable_shows` returns `hasRestreamKey` / `restreamKeyTail` instead of the key.
See `references/redaction.md`.

## Requirements

- The **BroadBanner MCP connector** (`mcp.broadbanner.com`) connected — the scheduling
  skills read show data and write scheduled-event state through it; no local
  `broadbanner.config.json` or `.creds/gateway.token` is required.
- The right browser for each account: Claude in Chrome for SOTSP (Substack / Restream
  Studio), the Claude built-in browser for Banner and Backbone Media's Restream account
  (`references/browser-routing.md`). This applies to scheduled runs too (pre-production
  auto-scheduling): those tasks run on this computer, because Cowork cloud sessions don't
  currently provide a browser. Each Restream skill checks who is signed in before it
  changes anything, and converts show times against the browser's own timezone.
- **One Restream session per account, many workspaces.** A Restream login lists every
  workspace on that account in the left sidebar. `restream-schedule-live` groups shows by
  workspace (from the D1 catalog's `displayName`) and switches in-app once per group;
  `restream-publish-clip` selects the clip's workspace the same way. No per-workspace
  login or tab.
- For `restream-publish-clip`: BannerBlast's start date (`RESTREAM_PUBLISH_SINCE`) set, so new clips get a Restream publishing slot. No local tracker files.
