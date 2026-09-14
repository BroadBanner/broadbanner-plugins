---
name: news-aggregate
description: "Aggregate news stories by keyword from weighted sources. Use when the user says 'aggregate news on', 'find stories about', 'news roundup for', 'what's happening with [topic]', 'gather coverage on', or provides keywords like 'Iran', 'Ukraine', 'climate' and wants sourced news. Also triggers when the user says 'run broad-news', 'news sweep', or 'source sweep'. Fetches from RSS feeds primarily, with web search and scraping fallbacks. Ranks results by a self-managing source scoring system stored in D1 via the BroadBanner gateway. RATBAC-gated: requires the broad_news add-on."
metadata:
  requiresTool: broad_news
  version: "0.1.0"
---

# News Aggregation

Aggregate recent news stories by keyword, ranked by a self-managing weighted source scoring system. This is the core data-gathering skill — it produces a structured story collection that feeds into `news-scripts` (video scripts + social blurbs) and `news-manage` (BannerBlast review/approve UI).

## Entitlement preflight

Call `get_creator_context` via the BroadBanner MCP connector. Confirm the caller holds the `broad_news` add-on (∈ `entitledTools`) or the equivalent cap ∈ `caps`, or `isAdmin`. If not entitled, stop:

> BroadNews is the News Aggregation add-on (broad_news). Your account isn't entitled yet — add it from your member portal.

## Inputs

| Input | Required | Example | Notes |
|---|---|---|---|
| keywords | Yes | ["Iran", "nuclear"] | One or more search terms. AND logic within a group. |
| timeframe | No | 24h, 7d, 30d | How far back to look. Default 48h. |
| maxStories | No | 15 | Cap on returned stories. Default 20. |
| minScore | No | 0.5 | Minimum source score threshold (0-1). Default 0.3. |

## Aggregation pipeline

### Step 1 — Load source registry and preferences

Load the creator's preferences and source registry in parallel:

```
GET /v1/broad-news/preferences
GET /v1/broad-news/sources
Authorization: Bearer <gateway-token>
```

Preferences include communityRead, communityWrite, communityBlendWeight, and defaults for timeframe/maxStories/minScore. Use these defaults when the creator doesn't specify inputs.

If the creator has no custom sources, the gateway returns the global seed list (see references/seed-sources.md).

If communityRead = true, also load community scores:

```
GET /v1/broad-news/community/scores
Authorization: Bearer <gateway-token>
```

These will be blended into ranking at Step 4.

### Step 2 — Fetch stories from RSS feeds

For each source with rssUrl and score >= minScore:
1. Fetch the RSS feed via web_fetch
2. Parse XML, extract item entries with title, link, pubDate, description
3. Filter items by keyword match in title or description
4. Filter by timeframe

If RSS yields fewer than 5 matching stories, fall back to Step 3.

### Step 3 — Web search fallback

Use WebSearch with the keywords to find additional coverage. For each result:
1. Check if the source domain is in the registry
2. If known: use its score for ranking
3. If unknown: assign a provisional score of 0.4 and flag for registry addition

### Step 4 — Deduplicate and rank

1. Deduplicate by URL and by title similarity (>80% token overlap = duplicate)
2. Resolve effective_source_score for each source:
   - Default (isolated): use the creator's personal score from news_sources
   - If communityRead = true: blend with community score: effective = creator_score * (1 - blend_weight) + community_score * blend_weight where blend_weight is from preferences (default 0.2, max 0.5). If a source has no community score, use creator's local score unblended.
3. Rank by: effective_source_score * 0.6 + recency_score * 0.25 + keyword_relevance * 0.15
4. Return top maxStories results

### Step 5 — Update source scores

After the creator reviews/uses stories (tracked by news-manage), call the gateway to update scores:

```
POST /v1/broad-news/sources/score
Authorization: Bearer <gateway-token>
```

Scoring rules: used +0.02 (cap 1.0), skipped -0.005 (floor 0.1), flagged -0.1 (floor 0.0, hidden at 0.0), add: insert new source with initialScore.

### Step 6 — Agent-side automatic feedback

During aggregation, the agent submits advisory feedback when it detects patterns:
- Contradiction detection: source contradicts 2+ others → unreliable
- Consistent quality: source in top 5 across 3+ runs and approved → reliable
- Paywall/empty content: no extractable content → mediocre

All agent feedback uses half-weight scoring. The creator can review, dismiss, or confirm in BannerBlast.

## Output format

Returns structured JSON with keywords, timeframe, storyCount, stories array (each with rank, title, url, source, published, summary, keyPoints, relevanceScore), sourcesUsed, and newSourcesDiscovered.

## Reference files

- references/seed-sources.md — Global seed list of outlets with initial scores
- references/scoring-algorithm.md — Full scoring algorithm specification and D1 schema
