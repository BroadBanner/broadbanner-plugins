# Source Scoring Algorithm & D1 Schema

## Isolation Model

Each creator's scoring model is **independent by default**. A creator's scores, feedback,
and source registry are scoped to their `creator_id` and never leak to other users. Each
creator trains their own model through their usage patterns and feedback.

Creators can **opt in** to a centralized community weighting table with granular read/write
permissions. This is controlled per-creator via the `news_preferences` table. Even when
opted in, the creator's local scores remain the primary model — community scores are
blended in as a secondary signal, never overwritten.

## D1 Schema

### Table: `news_preferences`

Per-creator settings including community participation toggle.

```sql
CREATE TABLE news_preferences (
  creator_id           TEXT PRIMARY KEY,      -- FK to members.contributor_id
  community_read       INTEGER NOT NULL DEFAULT 0, -- 1 = blend community scores into ranking
  community_write      INTEGER NOT NULL DEFAULT 0, -- 1 = contribute feedback to community pool
  community_blend_weight REAL NOT NULL DEFAULT 0.2, -- how much community score influences ranking (0.0–0.5)
  writing_style        TEXT,                  -- JSON: { tone, vocabulary, avoidWords, signaturePhrase, hashtagStyle, scriptFormat }
  default_timeframe    TEXT DEFAULT '48h',
  default_max_stories  INTEGER DEFAULT 20,
  default_min_score    REAL DEFAULT 0.3,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table: `news_sources` (creator-scoped)

Each creator gets their own copy of source scores. Rows are per-creator, per-domain.

```sql
CREATE TABLE news_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id  TEXT NOT NULL,           -- FK to members.contributor_id
  domain      TEXT NOT NULL,           -- e.g., "reuters.com"
  name        TEXT NOT NULL,           -- e.g., "Reuters"
  rss_url     TEXT,                    -- nullable, not all sources have RSS
  score       REAL NOT NULL DEFAULT 0.5,  -- 0.0–1.0, creator's personal score
  use_count   INTEGER NOT NULL DEFAULT 0,
  skip_count  INTEGER NOT NULL DEFAULT 0,
  flag_count  INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT,                    -- ISO 8601
  tags        TEXT,                    -- JSON array, e.g., '["wire","intl"]'
  is_global   INTEGER NOT NULL DEFAULT 0, -- 1 = seed source, 0 = creator-added
  hidden      INTEGER NOT NULL DEFAULT 0, -- 1 = score hit 0, hidden from results
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(creator_id, domain)
);

CREATE INDEX idx_news_sources_creator ON news_sources(creator_id, score DESC);
CREATE INDEX idx_news_sources_domain ON news_sources(domain);
```

### Table: `community_source_scores` (centralized, opt-in)

Aggregated scores from all creators who have opted in with `community_write = 1`.
No individual creator data is exposed — only aggregate statistics.

```sql
CREATE TABLE community_source_scores (
  domain          TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  avg_score       REAL NOT NULL DEFAULT 0.5,  -- weighted average across opted-in creators
  contributor_count INTEGER NOT NULL DEFAULT 0, -- how many creators have scored this source
  total_uses      INTEGER NOT NULL DEFAULT 0,
  total_flags     INTEGER NOT NULL DEFAULT 0,
  total_feedback  INTEGER NOT NULL DEFAULT 0,
  sentiment       REAL NOT NULL DEFAULT 0.0,   -- -1.0 to 1.0, aggregate feedback sentiment
  tags            TEXT,                         -- JSON array, union of all contributor tags
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_community_scores ON community_source_scores(avg_score DESC);
```

### Table: `news_story_log`

Tracks which stories were surfaced and what action the creator took, enabling score updates
and analytics.

```sql
CREATE TABLE news_story_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id  TEXT NOT NULL,
  domain      TEXT NOT NULL,
  story_url   TEXT NOT NULL,
  story_title TEXT,
  keywords    TEXT,                    -- JSON array of keywords used in the query
  action      TEXT NOT NULL,           -- 'surfaced', 'used', 'skipped', 'flagged'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_story_log_creator ON news_story_log(creator_id, created_at DESC);
CREATE INDEX idx_story_log_domain ON news_story_log(domain, action);
```

### Table: `source_feedback`

Stores explicit feedback from both creators and the agent, with full audit trail.

```sql
CREATE TABLE source_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id  TEXT NOT NULL,
  domain      TEXT NOT NULL,
  rating      TEXT NOT NULL,             -- 'reliable','useful','mediocre','unreliable','biased','inaccurate'
  note        TEXT,                      -- free-text explanation
  origin      TEXT NOT NULL DEFAULT 'user', -- 'user' or 'agent'
  story_url   TEXT,                      -- optional: the story that prompted feedback
  story_title TEXT,
  score_delta REAL NOT NULL,             -- the actual score change applied
  dismissed   INTEGER NOT NULL DEFAULT 0, -- 1 = creator dismissed agent feedback (score reverted)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedback_creator ON source_feedback(creator_id, domain, created_at DESC);
CREATE INDEX idx_feedback_origin ON source_feedback(origin, rating);
```

**Feedback weight rules:**
- `origin = 'user'`: full score delta as defined in the rating table
- `origin = 'agent'`: score delta halved (agent feedback is advisory)
- When a creator dismisses agent feedback: `score_delta` is reversed, `dismissed = 1`
- When a creator confirms agent feedback: `score_delta` is doubled to full user weight

## Gateway API Endpoints

All endpoints require `Authorization: Bearer <gateway-token>` and are scoped to the
authenticated creator via the token's `contributorId`.

### GET /v1/broad-news/sources

Returns the creator's source registry. If no custom sources exist, returns the global
seed list with default scores.

**Response:**
```json
{
  "sources": [
    {
      "domain": "reuters.com",
      "name": "Reuters",
      "rssUrl": "https://...",
      "score": 0.92,
      "useCount": 47,
      "skipCount": 3,
      "lastUsed": "2026-09-13T10:00:00Z",
      "tags": ["wire", "intl", "breaking"],
      "isGlobal": true
    }
  ],
  "totalSources": 24,
  "avgScore": 0.76
}
```

### POST /v1/broad-news/sources/score

Batch-update source scores after creator interaction.

**Request:**
```json
{
  "updates": [
    { "domain": "reuters.com", "action": "used", "storyUrl": "https://..." },
    { "domain": "sketchy-blog.com", "action": "flagged" },
    { "domain": "new-outlet.com", "action": "add", "name": "New Outlet", "initialScore": 0.5, "tags": ["tech"] }
  ]
}
```

**Score update rules:**

| Action    | Score change | Floor/Cap | Side effects                          |
| --------- | --------- | --------- | ------------------------------------- |
| `used`    | +0.02     | cap 1.0   | useCount++, lastUsed = now            |
| `skipped` | -0.005    | floor 0.1 | skipCount++                           |
| `flagged` | -0.10     | floor 0.0 | flagCount++, hidden=1 if score <= 0.0  |
| `add`     | set init  | —         | Insert new row with initialScore      |
| `remove`  | —         | —         | Set hidden=1                          |
| `restore` | reset 0.4 | —         | Set hidden=0, score=0.4               |

**Decay:** scores decay by 0.001/day for sources unused in the last 30 days (floor 0.1).
A nightly cron job on the gateway worker handles this.

### POST /v1/broad-news/sources/feedback

Submit explicit feedback on a source — from either the creator or the agent.

**Request:**
```json
{
  "domain": "reuters.com",
  "rating": "reliable",
  "note": "Consistently accurate on Iran coverage",
  "origin": "user",
  "storyUrl": "https://...",
  "storyTitle": "Iran nuclear talks resume in Vienna"
}
```

**Rating to score delta:**

| Rating        | User delta | Agent delta (half weight) |
| ------------- | ------ | --------------------- |
| `reliable`    | +0.05  | +0.025                |
| `useful`      | +0.02  | +0.01                 |
| `mediocre`    | -0.01  | -0.005                |
| `unreliable`  | -0.05  | -0.025                |
| `biased`      | -0.08  | -0.04                 |
| `inaccurate`  | -0.10  | -0.05                 |

**Response:**
```json
{
  "feedbackId": 42,
  "domain": "reuters.com",
  "previousScore": 0.90,
  "newScore": 0.95,
  "scoreDelta": 0.05,
  "origin": "user"
}
```

### GET /v1/broad-news/sources/{domain}/feedback

Retrieve the feedback history for a specific source.

**Response:**
```json
{
  "domain": "reuters.com",
  "feedbackCount": 12,
  "feedback": [
    {
      "id": 42,
      "rating": "reliable",
      "note": "Consistently accurate on Iran coverage",
      "origin": "user",
      "storyUrl": "https://...",
      "scoreDelta": 0.05,
      "dismissed": false,
      "createdAt": "2026-09-14T10:00:00Z"
    }
  ]
}
```

### POST /v1/broad-news/sources/feedback/{feedbackId}/dismiss

Creator dismisses agent-originated feedback (reverses the score impact).

**Response:**
```json
{
  "feedbackId": 43,
  "reversed": true,
  "previousScore": 0.85,
  "newScore": 0.875,
  "reversedDelta": 0.025
}
```

### POST /v1/broad-news/sources/feedback/{feedbackId}/confirm

Creator confirms agent-originated feedback (promotes to full user weight).

**Response:**
```json
{
  "feedbackId": 43,
  "confirmed": true,
  "previousScore": 0.875,
  "newScore": 0.85,
  "additionalDelta": -0.025
}
```

### GET /v1/broad-news/sources/stats

Analytics endpoint for the management page.

**Response:**
```json
{
  "topSources": [...],
  "leastUsed": [...],
  "recentlyFlagged": [...],
  "scoreDistribution": { "high": 8, "mid": 12, "low": 4 },
  "totalStoriesSurfaced": 342,
  "totalStoriesUsed": 87
}
```

### GET /v1/broad-news/preferences

Returns the creator's broad-news preferences including community participation settings.

**Response:**
```json
{
  "communityRead": false,
  "communityWrite": false,
  "communityBlendWeight": 0.2,
  "writingStyle": { "tone": "direct", "vocabulary": "accessible" },
  "defaultTimeframe": "48h",
  "defaultMaxStories": 20,
  "defaultMinScore": 0.3
}
```

### PATCH /v1/broad-news/preferences

Update creator preferences. Partial updates — only fields included are modified.

**Request:**
```json
{
  "communityRead": true,
  "communityWrite": true,
  "communityBlendWeight": 0.3
}
```

### GET /v1/broad-news/community/scores

Returns the centralized community source scores. Only accessible when `communityRead = true`
in the creator's preferences. Returns `403` otherwise.

**Response:**
```json
{
  "sources": [
    {
      "domain": "reuters.com",
      "name": "Reuters",
      "avgScore": 0.91,
      "contributorCount": 14,
      "totalUses": 523,
      "sentiment": 0.72,
      "tags": ["wire", "intl", "breaking"]
    }
  ],
  "totalContributors": 23,
  "lastUpdated": "2026-09-14T08:00:00Z"
}
```

### POST /v1/broad-news/community/sync

Called by the gateway worker after a creator's score update when `communityWrite = true`.
Not called directly by the client — this is an internal gateway endpoint.

Aggregates the creator's latest scores into the `community_source_scores` table:
- Recalculates `avg_score` across all contributing creators for each affected domain
- Updates `contributor_count`, `total_uses`, `total_flags`, `total_feedback`, `sentiment`

No individual creator data is exposed in the community table — only aggregate statistics.

## Ranking Formula

Stories are ranked by a composite score:

```
rank_score = effective_source_score * 0.6 + recency_score * 0.25 + keyword_relevance * 0.15
```

### Source score resolution (isolation model)

The `effective_source_score` depends on the creator's community participation setting:

**Default (isolated, `communityRead = false`):**
```
effective_source_score = creator_score
```

The creator's personal `news_sources.score` is the only input. No community data is read.

**Community read enabled (`communityRead = true`):**
```
effective_source_score = creator_score * (1 - blend_weight) + community_score * blend_weight
```

Where `blend_weight` is `news_preferences.community_blend_weight` (default 0.2, range 0.0–0.5).
If the source has no community score (not enough contributors), the creator's local score is
used unblended.

This ensures the creator's own training always dominates — community data is a secondary
signal that surfaces sources the broader network has found valuable.

**Community write enabled (`communityWrite = true`):**

When the creator's scores are updated (via `used`, `skipped`, `flagged`, or explicit feedback),
the gateway also triggers an internal `POST /v1/broad-news/community/sync` to update the
centralized table. The creator's individual data is never exposed — only aggregate statistics
flow into the community table.

**Combined read+write:**

A creator can enable both independently. Read without write means they benefit from community
intelligence without contributing. Write without read means they contribute altruistically
while keeping their own model fully independent.

### Other score components

- **recency_score** (0.0–1.0): linear decay from 1.0 (published now) to 0.0 (at timeframe boundary)
  - Formula: `max(0, 1 - (hours_since_published / timeframe_hours))`
- **keyword_relevance** (0.0–1.0): fraction of query keywords found in title + description
  - Title matches weighted 2x vs description matches
  - Formula: `(title_matches * 2 + desc_matches) / (total_keywords * 3)`

## Tag Affinity

When aggregating, sources with tags matching the keyword domain get a 10% boost to their
`effective_source_score` component:

- Keywords about countries/regions match `intl`, `middle-east`, region-specific tags
- Keywords about technology match `tech`, `surveillance`, `data`
- Keywords about law/policy match `legal`, `policy`, `civil-liberties`

This soft-biases results toward specialist outlets without hard-excluding generalists.
