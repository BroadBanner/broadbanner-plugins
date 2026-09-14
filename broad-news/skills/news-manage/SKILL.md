---
name: news-manage
description: "Manage generated news scripts and blurbs in the BannerBlast section. Use when the user says 'review my scripts', 'manage news content', 'approve the blurbs', 'edit the scripts', 'delete that draft', 'post the approved blurb', 'push to article draft', or when working with generated broad-news content. Provides the member-gated management workflow: review, edit, approve, delete generated content, post approved blurbs with uploaded video, and feed key points + source links into the article draft generator. RATBAC-gated: requires the broad_news add-on."
metadata:
  requiresTool: broad_news
  version: "0.1.0"
---

# BannerBlast News Content Management

Manage the review/edit/approve lifecycle for generated news scripts and social blurbs.
This skill operates within the BannerBlast section of the BroadBanner member portal,
providing a member-gated management page for broad-news content.

## Entitlement preflight

Same as `news-aggregate`: confirm `broad_news` add-on via `get_creator_context`.

## Inputs

| Input      | Required | Example               | Notes                                          |
| ---------- | -------- | --------------------- | ---------------------------------------------- |
| `action`   | Yes      | `review`, `approve`, `edit`, `delete`, `post`, `draft`, `feedback` | What the creator wants to do |
| `itemId`   | Depends  | `iran-nuclear-sep14`  | Required for approve/edit/delete/post/draft     |
| `edits`    | No       | `{ "script": "..." }` | For edit action — partial update fields        |
| `feedback` | No       | `{ "domain": "...", "rating": "...", "note": "..." }` | For feedback action — source feedback |

## Available actions

### `review` — List pending content

Retrieve all generated content awaiting review:

```
GET /v1/broad-news/content?status=pending
Authorization: Bearer <gateway-token>
```

Present a summary of each item:
- Headline / cluster topic
- Number of sources
- Script length and estimated seconds
- Blurb previews (first 100 chars each)
- Generated timestamp

### `approve` — Mark content as approved

```
POST /v1/broad-news/content/{itemId}/approve
Authorization: Bearer <gateway-token>
```

Approved content is eligible for posting and article draft generation. Approving also
triggers source score updates: all sources used in the approved item get a `used` action
sent to the scoring engine.

### `edit` — Modify generated content

```
PATCH /v1/broad-news/content/{itemId}
Authorization: Bearer <gateway-token>
Content-Type: application/json

{
  "script": { "teleprompter": "...", "outline": "..." },
  "blurbs": { "substack": { "text": "..." } }
}
```

Partial updates — only fields included in the request are modified. The creator can edit
scripts, blurbs, hashtags, or any combination. Edited content returns to `pending` status
unless explicitly re-approved in the same call (`"approve": true`).

### `delete` — Remove generated content

```
DELETE /v1/broad-news/content/{itemId}
Authorization: Bearer <gateway-token>
```

Soft-deletes the content. Sources from deleted items get a `skipped` action in the
scoring engine.

### `post` — Post approved blurb with video

This action publishes an approved social blurb alongside a video. It chains into the
existing BannerBlast posting infrastructure:

1. Confirm the item is in `approved` status
2. Retrieve the approved blurb for the target platform(s)
3. If the creator has uploaded a video via BannerBlast (post_video), associate it
4. Use the BroadBanner MCP connector's `post_video` tool (for video+blurb) or
   `post_text` tool (for text-only blurb) to queue the post
5. Mark the item as `posted` with platform and timestamp

For Substack specifically, the blurb queues via the existing `release-substack-clips` /
`release-substack-text` skills from the social-distribution plugin — broad-news writes
the queue entry, the existing release skills drain it.

### `feedback` — Submit source feedback

Both the creator (via the webapp) and the agent (via the plugin) can submit feedback on
individual sources. Feedback directly influences source scoring and is logged for
transparency.

```
POST /v1/broad-news/sources/feedback
Authorization: Bearer <gateway-token>
Content-Type: application/json

{
  "domain": "reuters.com",
  "rating": "reliable",
  "note": "Consistently accurate on Iran coverage",
  "origin": "user",
  "storyUrl": "https://...",
  "storyTitle": "..."
}
```

**Feedback fields:**

| Field      | Required | Values                                          |
| ---------- | -------- | ----------------------------------------------- |
| `domain`   | Yes      | Source domain                                   |
| `rating`   | Yes      | `reliable`, `useful`, `mediocre`, `unreliable`, `biased`, `inaccurate` |
| `note`     | No       | Free-text explanation (shown in feedback history)|
| `origin`   | Yes      | `user` (from webapp/chat) or `agent` (from plugin during aggregation) |
| `storyUrl` | No       | The specific story that prompted the feedback   |
| `storyTitle`| No      | For display in feedback history                 |

**Rating to score impact:**

| Rating        | Score delta | Notes                                           |
| ------------- | --------- | ----------------------------------------------- |
| `reliable`    | +0.05     | Strong positive signal                          |
| `useful`      | +0.02     | Mild positive (same as "used")                  |
| `mediocre`    | -0.01     | Slight negative                                 |
| `unreliable`  | -0.05     | Significant negative                            |
| `biased`      | -0.08     | Heavy negative, tagged for review               |
| `inaccurate`  | -0.10     | Same as "flagged", hidden if score hits 0       |

User feedback carries 2x weight vs agent feedback — the creator's judgment is
authoritative. Agent feedback is advisory and helps surface patterns.

**Feedback from the agent (automatic):**

During `news-aggregate`, the agent may also submit feedback when it detects:
- A source's content contradicts multiple other sources on the same story -> `unreliable`
- A source consistently appears in top results and gets approved -> `reliable`
- A source's content is behind a hard paywall with no extractable content -> `mediocre`

Agent-originated feedback is always logged with `origin: "agent"` so the creator can
review and override in the webapp.

**Feedback history (webapp):**

The source management view in BannerBlast shows a feedback timeline per source:
- Who submitted (user or agent)
- Rating and note
- Story context (if provided)
- Timestamp
- Resulting score change

Creators can dismiss agent feedback (reverting its score impact) or confirm it (promoting
it to user-weight).

### `draft` — Feed into article draft generator

Push approved content's key points and source links into the article draft system:

```
POST /v1/broad-news/content/{itemId}/to-draft
Authorization: Bearer <gateway-token>
```

This creates (or appends to) an article draft in the member portal with:

- Key points from the story cluster as structured sections
- Inline source citations with links
- The script's context and implications as draft prose
- A "Sources" footer with all referenced URLs

The draft appears at `app.broadbanner.com/app/articles/<generated-slug>` in `draft` status,
editable by the creator before publication. This uses the same `create_article` MCP tool
as the post-production pipeline's `article-publish` skill.

## BannerBlast Management Page

The webapp management page (rendered at `app.broadbanner.com/app/bannerblast/news`) shows:

### Dashboard view
- **Pending** items awaiting review (newest first)
- **Approved** items ready to post or push to draft
- **Posted** items with platform + timestamp
- **Source health** summary (top sources, flagged sources, avg score)

### Item detail view
- Full teleprompter script (editable)
- Bullet outline (editable)
- Per-platform blurbs (editable, with character count)
- Source list with individual scores
- Action buttons: Approve / Edit / Delete / Post / Push to Draft

### Source management view
- Full source registry with scores, use counts, tags
- Add / remove / restore sources
- Flag unreliable sources
- Import sources from URL or RSS feed
- **Feedback timeline** per source: chronological list of all feedback (user + agent)
  - Each entry shows: origin badge (user/agent), rating, note, story context, timestamp, score delta
  - Agent feedback entries have Dismiss / Confirm buttons
  - Dismissing reverses the score impact; confirming promotes to full user weight

### Feedback submission (webapp)
- On any story card or source detail page, a feedback button opens a quick form:
  - Rating selector (reliable / useful / mediocre / unreliable / biased / inaccurate)
  - Optional note field
  - Submit sends to `POST /v1/broad-news/sources/feedback` with `origin: "user"`
- Inline feedback on aggregated results: thumbs up/down on individual stories
  - Thumbs up -> `useful` feedback for that source
  - Thumbs down -> opens the full rating selector for more granular feedback

### Writing style configuration
- Tone selector (direct, conversational, analytical, urgent)
- Custom vocabulary / phrases
- Words to avoid
- Signature phrases
- Hashtag style preferences
- Script format preference (teleprompter, outline, both)

### Scoring model &amp; community settings
- **Model isolation indicator:** shows "Independent" by default, confirming the creator's
  scoring model is private and scoped to their account only
- **Community read toggle:** "Blend community intelligence into my rankings"
  - When enabled, shows a blend weight slider (0%-50%, default 20%)
  - Tooltip: "Your personal scores always dominate. Community data surfaces sources that
    other creators on the network have found valuable."
- **Community write toggle:** "Contribute my scoring data to the community pool"
  - Tooltip: "Your individual data is never exposed. Only aggregate statistics (average
    scores, usage counts) are shared — no one sees your specific scores or feedback."
- **Community stats preview** (visible when read is enabled):
  - Number of contributing creators
  - Top community-rated sources
  - How community scores differ from the creator's own for their top sources
- All toggles call `PATCH /v1/broad-news/preferences` on change
- Read and write are independent — any combination is valid

All management page state is stored in D1 and served by the gateway. The webapp is a
standard BannerBlast SPA route — no additional deployment infrastructure.

## Integration points

| System                    | Integration                                    |
| ------------------------- | ---------------------------------------------- |
| `news-aggregate`          | Provides story data consumed by this skill     |
| `news-scripts`            | Provides generated scripts/blurbs managed here |
| Source scoring (gateway)  | Score updates triggered by approve/delete       |
| `post_video` / `post_text`| Queue entries for social posting               |
| `create_article`          | Draft creation in the member portal            |
| `release-substack-*`      | Existing drain skills pick up queued posts     |

## RATBAC capability

The `broad_news` capability gates all three broad-news skills. It maps to:
- **Add-on**: `broad_news` (under the BannerBlast tool family)
- **Caps**: `broad_news:read` (aggregate + view), `broad_news:write` (edit/approve/post/draft)
- **Tier gating**: Available at Production tier and above, or as a standalone add-on
