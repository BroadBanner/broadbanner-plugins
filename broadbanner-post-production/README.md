# BroadBanner Post-Production Plugin

Production+ post-production automation for **Banner and Backbone Media** — the
`post_production_distribution` add-on. Turn a finished Substack **live draft** into a
publication-ready **review article**, corrected against the **live roster** of who was
actually in the room, and pushed as an **editable DRAFT** into the member portal
(`app.broadbanner.com/app/reviews/…`) for the creator to review, edit, and publish.

> Successor to the `broadbanner-episode-pipeline` Pages flow. The old pipeline slugged
> everything from a local `broadbanner.config.json` / `pod-map.json` and published by
> opening a GitHub Pages PR. This plugin derives everything from **two inputs** — the
> Substack draft URL and the human-readable series name — resolving series, brand, roster,
> and editorial config **live through the BroadBanner MCP connector**, and publishes to the
> portal instead of Pages. No local config, no git, no PR.

## The trigger contract

The operator provides **only two inputs**:

1. **The Substack draft URL** (the post editor URL for the just-finished live).
2. **The human-readable series name** (e.g. `Palantalk`, `Intelligent Masculinity`).

Everything else — series id, brand, episode slug/title/date, the host/guest roster, the
review format, editorial voice, length, and label — is **derived**. There is no local
`broadbanner.config.json`, no `pod-map.json`, and no manually-supplied episode id, date,
guest list, format, or voice.

## Skills

| Skill                  | Description                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `post-production`      | **Orchestrator.** Inputs = `{ draftUrl, seriesName }` only. Resolves the series via `get_creator_context` + `get_show_roster`, then chains transcript-download → transcript-correction → episode-review → review-publish. Everything after the two inputs is automatic. |
| `transcript-download`  | Downloads the transcript `.txt` from the Substack editor via browser automation, deriving the episode slug/title/date **from the draft's own post title** (no local naming config).                                                |
| `transcript-correction`| Two-phase correction (deterministic dictionary + AI). Merges the **live** primary-host/host/guest names from `get_show_roster` into BOTH the name-normalization pass and the AI speaker-attribution pass. Self-learning dictionary append preserved. |
| `episode-review`       | Generates the review markdown + social copy using the **server-sourced** `effectiveReviewConfig` (`reviewFormat` / `editorialVoice` / `reviewLength` / `reviewLabel` / `seasonBookMode` / `takeawayCountRange`) from `get_show_roster`. |
| `review-publish`       | Pushes the generated markdown as a **DRAFT review** into the portal via the `create_review` connector tool, and returns the `https://app.broadbanner.com/app/reviews/<slug>` URL for the member to review/edit/publish. **No git, no Pages.** |

## MCP connector tools

All data flows through the **BroadBanner MCP connector** (server `broadbanner`,
`https://mcp.broadbanner.com/mcp`) — there is no local config, no gateway token, no request
signing. Three tools carry this plugin:

| Tool                  | Shape                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_creator_context` | → `{ contributorId, substackHandle, brand, brands?, pods: string[] }`. `pods` are the creator's authorized series ids.                                                                                                                                                                                             |
| `get_show_roster`     | `({ showId?, seriesId? })` → `{ roster: { seriesId, seriesTitle, showId, brandId, primaryHost, hosts[], guests[], effectiveReviewConfig: { reviewFormat, editorialVoice, reviewLength, takeawayCountRange, seasonBookMode, reviewLabel } } }`. People are `{ id, name, displayName }`.                              |
| `create_review`       | `({ seriesId, title, bodyMd, showId?, slug?, subtitle?, reviewLabel?, authorNames?, episodeDate?, coverImageUrl?, socialCopy? })` → `{ ok, id, slug, url }` where `url = https://app.broadbanner.com/app/reviews/<slug>`.                                                                                          |

`get_show_roster` and `create_review` are **gated on the `post_production_distribution`
add-on** and fail closed for a session without it.

## Entitlement / authority

- Every skill is tagged `metadata.requiresTool: post_production_distribution` and begins
  with an advisory **Step-0 entitlement preflight** (via `get_creator_context`). If the
  connector returns a capability summary and the add-on is absent, the skill stops with a
  CTA to the membership page. If the context omits the capability fields (older connector),
  the skill proceeds — the connector's `get_show_roster` / `create_review` gate is the
  server-side backstop.
- This mirrors how `broadbanner-live-production` skills preflight `creator_workspace`.

## Requirements

- The **BroadBanner MCP connector** (`mcp.broadbanner.com`) connected — the skills resolve
  series, roster, editorial config, and publish through it; no local
  `broadbanner.config.json` / `pod-map.json` / gateway token is required.
- Claude in Chrome on the **single** connected BroadBanner Chrome profile, logged into
  Substack (for the transcript download from the post editor). The skills do not route
  among profiles.
