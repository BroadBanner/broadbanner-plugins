# BroadBanner Post-Production Plugin

Production+ post-production automation for **Banner and Backbone Media** — the
`post_production_distribution` add-on. Turn a finished Substack **live draft** into a
publication-ready **review article**, corrected against the **live roster** of who was
actually in the room, and pushed as an **editable DRAFT** into the member portal
(`app.broadbanner.com/app/articles/…`) for the creator to review, edit, and publish.

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
| `post-production`      | **Orchestrator.** Inputs = `{ draftUrl, seriesName }` only. Resolves the series via `get_creator_context` + `get_show_roster`, then chains section-select → transcript-download → transcript-correction → episode-review → article-publish. Everything after the two inputs is automatic. |
| `section-select`       | Files the Substack draft under its series **section** via the editor's `Choose a section` dropdown, matching the connector's live `seriesTitle` (case-insensitive). Skips on single-section publications or when already set; lists options and stops on no match — never picks the publication root. |
| `transcript-download`  | Captures the transcript `.txt` text **in-page** from the Substack editor (no `~/Downloads`, no local file) and stores it in D1 via `save_transcript`, deriving the episode slug/title/date **from the draft's own post title** (no local naming config). |
| `transcript-correction`| Two-phase correction (deterministic dictionary + AI). Merges the **live** primary-host/host/guest names from `get_show_roster` into BOTH the name-normalization pass and the AI speaker-attribution pass. Self-learning dictionary append preserved. |
| `episode-review`       | Generates the article markdown + social copy using the **server-sourced** `effectiveArticleConfig` (`articleFormat` / `editorialVoice` / `articleLength` / `articleLabel` / `seasonBookMode` / `takeawayCountRange`) from `get_show_roster` — show ?? series ?? **brand** defaults. Also loads `get_writing_context { form: "episode-review" }` and layers its instructions over the `voice-*.md` preset (explicit brand/series voice wins on conflict). |
| `article-publish`       | Pushes the generated markdown as a **DRAFT article** into the portal via the `create_article` connector tool, and returns the `https://app.broadbanner.com/app/articles/<slug>` URL for the member to review/edit/publish. **No git, no Pages.** |
| `article-write`        | **General writing.** Drafts an **opinion piece, essay, column, or other** article under a brand or series: loads `get_writing_context` (brand + series voice, personal style, learned rules, exemplars) and follows every instruction, researches with `search_archive` / `get_article` / `get_transcript` (BroadNews tools for current-events facts when available, otherwise flags claims to verify), confirms an outline, then saves a DRAFT via `create_article { origin: "ai", form }`. Revises via `update_article` (history via `list_article_revisions`), tunes brand/series voice with `get_voice` / `set_voice`, and lists/confirms/dismisses learned rules with `article_style_rules`. **Never publishes.** |
| `backfill-articles`    | **Archive backfill.** Imports a member's already-published Substack posts into the archive: for each provided link it captures the post title/date/full content as markdown and creates a **published** article via `create_article`, organized under the named series or (no series) the member's **brand**, with a `substackUrl` link back to the post. |

## MCP connector tools

All data flows through the **BroadBanner MCP connector** (server `broadbanner`,
`https://mcp.broadbanner.com/mcp`) — there is no local config, no gateway token, no request
signing. These tools carry this plugin:

| Tool                  | Shape                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_creator_context` | → `{ contributorId, substackHandle, brand, brands?, pods: string[] }`. `pods` are the creator's authorized series ids.                                                                                                                                                                                             |
| `get_show_roster`     | `({ showId?, seriesId? })` → `{ roster: { seriesId, seriesTitle, showId, brandId, primaryHost, hosts[], guests[], effectiveArticleConfig: { articleFormat, editorialVoice, articleLength, takeawayCountRange, seasonBookMode, articleLabel } } }`. People are `{ id, name, displayName }`.                              |
| `create_article`       | `({ seriesId, title, bodyMd, showId?, slug?, subtitle?, articleLabel?, authorNames?, episodeDate?, coverImageUrl?, socialCopy? })` → `{ ok, id, slug, url }` where `url = https://app.broadbanner.com/app/articles/<slug>`.                                                                                          |
| `save_transcript`     | `({ seriesId, episodeSlug, showId?, episodeTitle?, episodeDate?, sourceUrl?, rawText?, correctedText?, append?, articleId? })` → `{ ok, created, transcript: { id, rawChars, correctedChars, … } }`. Upsert by (seriesId, episodeSlug); `append: true` concatenates a chunk; `articleId` links it to the article. |
| `get_transcript`      | `({ transcriptId? \| seriesId + episodeSlug, version?, offset?, limit? })` → `{ transcript, version, text, totalChars, nextOffset }` — paged by character offset. |
| `get_writing_context` | `({ seriesId? \| brandId? \| showId?, form?, keywords?, exemplars?, kinds?, exemplarsPerKind?, relatedLimit? })` → `{ scope, articleConfig, voice: { series, brand, effective }, writingStyle, profile, rules, exemplars, relatedArticles, transcripts, instructions }`. Call before drafting any article; follow every `instructions` entry in order. |
| `search_archive`      | `({ seriesId? \| brandId?, query, limit? })` → `[{ kind: "article" \| "transcript", id, slug?, title, date, seriesId, snippet }]` — FTS over published articles and transcripts in scope. |
| `list_articles` / `get_article` | The creator's own articles; one article (incl. `bodyMd`) by slug. |
| `list_article_revisions` | `({ id })` → revision history (revision, source AI/You/Imported/Restored, title, wordCount, status, note, createdAt). |
| `update_article`      | `({ id, title?, subtitle?, bodyMd?, form?, tags?, revisionNote? })` — revise a draft as the agent (`editSource: "ai"`). **Cannot change status.** |
| `get_voice` / `set_voice` | `({ scope: "brand" \| "series", id, ...fields })` — read (with `canEdit`) or merge-update a brand/series voice profile. Series overrides brand field by field. |
| `article_style_rules` | `({ action: "list" \| "confirm" \| "dismiss" \| "reset", ruleId? })` — the creator's personal learned rules. |

`create_article` also takes `origin` (`ai` default · `import` for backfill) and `form`
(`episode-review` · `news` · `opinion` · `essay` · `column` · `other`).

All data tools are **gated on the `post_production_distribution` add-on** (the
`articles:read` / `articles:self-write` caps) and fail closed for a session without it.

## Transcripts live in D1 — local or remote Cowork

The transcript is **not** a local file. transcript-download captures the `.txt` text
in-page and stores it with `save_transcript`; transcript-correction stores the corrected
version alongside it; article-publish links it to the article. Every step (and any
resumed run in a new session) reads it back with `get_transcript`. That removes the old
`~/Downloads` + `/tmp/post-production/` hand-off, which failed in a **remote (cloud)
Cowork environment** where the browser's downloads never reach the agent. The member
downloads the corrected (or raw) transcript from the article page in the portal
(`app.broadbanner.com/app/articles/<slug>` → **Download transcript**).

## Entitlement / authority

- Every skill is tagged `metadata.requiresTool: post_production_distribution` and begins
  with an advisory **Step-0 entitlement preflight** (via `get_creator_context`). If the
  connector returns a capability summary and the add-on is absent, the skill stops with a
  CTA to the membership page. If the context omits the capability fields (older connector),
  the skill proceeds — the connector's `get_show_roster` / `create_article` gate is the
  server-side backstop.
- This mirrors how `broadbanner-live-production` skills preflight `creator_workspace`.

## Requirements

- The **BroadBanner MCP connector** (`mcp.broadbanner.com`) connected — the skills resolve
  series, roster, editorial config, and publish through it; no local
  `broadbanner.config.json` / `pod-map.json` / gateway token is required.
- A browser logged into Substack (for section-select + the transcript capture from the
  post editor): Claude in Chrome on the **single** connected BroadBanner Chrome profile,
  **or** the browser of a remote Cowork environment. The skills do not route among
  profiles, and need no local files.

## How the writing improves (Writing Studio)

The agent **never publishes**. Every draft it creates (`origin: "ai"`) keeps its original
as revision 1; when the member edits and publishes it in the portal, BroadBanner learns
from the difference — once per edit — and feeds the result back through
`get_writing_context` as rules, a style profile and exemplars. Hand-written dashboard
articles and imported posts are learned from too. Brand/series flavour comes from the
explicit voice settings (`get_voice` / `set_voice`, or the Voice panel in the portal);
learned memory stays per person. See `Documentation/engineering/WRITING-STUDIO-DESIGN.md`.
