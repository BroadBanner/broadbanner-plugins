# BroadBanner Restream Plugin

Restream workflow automation for **Banner and Backbone Media**.

## Skills

| Skill | Description |
|---|---|
| `restream-schedule-live` | Schedule upcoming podcast live streams as Restream events from show data served by the BroadBanner Gateway (`https://gateway.broadbanner.com/v1/shows`, D1-backed). Writes the scheduled-event state back via `gateway.broadbanner.com/v1/restream-events` — no direct Data-Worker traffic. |
| `restream-publish-clip` | Publish pending clips to TikTok and YouTube (and Facebook for B&B) via the Restream clips UI. Handles batches with staggered 10–40 minute scheduling. |

## Requirements

- Authenticated Restream session in Chrome (Claude in Chrome extension)
- `Social-Distribution/` directory with restream-clip tracker files (for clip publishing)
- BroadBanner Gateway reachable at `https://gateway.broadbanner.com` with an **admin-tier** workspace cap-token at `<PROJECT_ROOT>/.creds/gateway.token` carrying `caps: ["shows:read", "restream:read", "restream:write"]` (auto-issued by `banner-blast init` / `banner-admin init` for admin operators on `@broadbanner/core` 1.16.0+)
