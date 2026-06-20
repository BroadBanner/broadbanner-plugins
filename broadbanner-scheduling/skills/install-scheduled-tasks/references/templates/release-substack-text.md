---
id: release-substack-text-{{PROJECT_BASENAME}}
description: Release {{PROJECT_BASENAME}}'s web-composed text posts to Substack (list + post + mark, via the BroadBanner connector).
cronExpression: "{{TEXT_RELEASE_CRON}}"
enabled: true
---

You are a recurring background poller that releases this workspace's web-composed text posts to Substack, keeping Substack close behind the Worker queue (Bluesky/Threads post within 0–3 min via that queue; this keeps Substack near-parity). Invoke the `release-substack-text` skill from the `broadbanner-social-distribution` plugin. This run is pre-approved to run autonomously — do NOT pause for confirmation.

Cadence note: Substack has no API, so release is browser automation on a poll — it can't be event-driven like the Worker queue. The schedule comes from the **release cadence preset** (`high` / `medium` / `low`) chosen at install: `high` ≈ `*/2 * * * *` (minimal lag, heaviest usage), `medium` (default) ≈ `*/30 * * * *`, `low` ≈ `0 9-21 * * *` (lightest). The common case (nothing pending) fast-exits cheaply, so cost scales with run count — pick `low` for a low-frequency publication, `high` for a busy one. Re-run `install-scheduled-tasks` with a different `--cadence` to change it, or hand-edit this `cronExpression` to any literal 5-field cron for full control.

Text release is a **single self-contained task** (no producer/consumer pair, no local queue): it lists pending posts, posts each to Substack, and marks each released in one pass.

## What to do

Invoke `release-substack-text`. It uses the **BroadBanner MCP connector** (no `.creds/`, no `broadbanner.config.json` — the CLI path is retired):

1. Calls the `list_pending_substack` tool. **If nothing is pending, it exits immediately** with a one-line "nothing pending" report — the common case, not an error. It does not open Substack.
2. Otherwise (oldest first, up to 5 per run): calls `get_creator_context` for the Substack handle, posts each note to Substack via browser automation (the same composer flow as `substack-note`), then calls `mark_substack_posted` to flip that tracker's substack slot `pending → posted` (or `failed` if the post didn't confirm). Any remainder beyond 5 goes out on the next run.

These are the text posts created from the BannerBlast web composer (`#blastItButton`), which ingests them with `substack: pending`. **Bluesky and Threads for the same posts are handled separately by the BannerBlast Worker queue (server-side, via API) — this task only touches Substack**, the one platform with no API.

## Prerequisites

- **The BroadBanner connector must be added and connected in Cowork** (Settings → Connectors → Add custom connector → `https://mcp.broadbanner.com/mcp` → sign in via WorkOS with the creator email). It provides identity, context, and the hosted data — there are no local credentials. If the `list_pending_substack` / `get_creator_context` / `mark_substack_posted` tools aren't available, the connector isn't connected and the skill stops.
- The browser Cowork drives must be **logged into the creator's Substack** (the account = `substackHandle` from `get_creator_context`), or the post stops rather than go out under the wrong identity. This is the one inherently-local piece (Substack has no API).

## Notes

- Close the browser tabs the flow opened when done.
- A post that fails verification is marked `failed` (not retried forever). To re-release a `failed` post after fixing the issue, flip its tracker's `platforms.substack.status` back to `pending`.
- Tune cadence the easy way by reinstalling with `--cadence high|medium|low`; or hand-edit this `cronExpression` to any literal 5-field cron (e.g. `*/30 9-21 * * *`) — a literal value overrides the preset.
