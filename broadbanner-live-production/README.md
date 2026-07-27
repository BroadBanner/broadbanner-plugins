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
| `restream-publish-clip` | Publish pending clips to TikTok and YouTube (and Facebook for B&B) via the Restream clips UI. Handles batches with staggered 10–40 minute scheduling. |

> **Note (follow-up):** `restream-publish-clip` maps to the Production+ add-on
> `post_production_distribution`, not `creator_workspace`. It rides here for now; a future
> split into a `broadbanner-clip-distribution` bundle will keep this plugin Creator+-pure.

## Entitlement / authority

- `substack-schedule-live` and `restream-schedule-live` are tagged
  `metadata.requiresTool: creator_workspace` and begin with an advisory entitlement
  preflight. Today they authorize via the BroadBanner MCP connector's admin tools
  (brand-admin / super-admin role); the connector fails closed for a session without a
  scheduling role. Creator-scoped scheduling (any host of a series) is a planned backend
  change — see `Documentation/engineering/PLUGIN-TIERING-AND-ENTITLEMENT-GATING.md`.

## Requirements

- The **BroadBanner MCP connector** (`mcp.broadbanner.com`) connected — the scheduling
  skills read show data and write scheduled-event state through it; no local
  `broadbanner.config.json` or `.creds/gateway.token` is required.
- Claude in Chrome extension on a **single** connected BroadBanner Chrome profile
  (authenticated Substack / Restream sessions). The skills do not route among profiles.
- `Social-Distribution/` directory with restream-clip tracker files (for `restream-publish-clip`).
