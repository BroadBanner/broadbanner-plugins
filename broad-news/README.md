# broad-news

News aggregation, weighted source scoring, and script/blurb generation for BroadBanner creators.

## What it does

Aggregates news stories by keyword from RSS feeds (primary), web search, and scraping fallbacks. Ranks results using a self-managing source scoring system stored in D1 via the BroadBanner gateway. Generates 30-90 second video scripts and platform-specific social blurbs with source links and hashtags. Integrates with BannerBlast for a full review/edit/approve workflow.

## Skills

| Skill            | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `news-aggregate` | Keyword-driven news aggregation with weighted source ranking  |
| `news-scripts`   | Generate video scripts and social blurbs from aggregated news |
| `news-manage`    | Review, edit, approve, post, and push content to article drafts |

## RATBAC

Gated by the `broad_news` add-on. Capabilities:
- `broad_news:read` — aggregate news, view content
- `broad_news:write` — edit, approve, post, push to article drafts

Available at Production tier and above, or as a standalone add-on.

## Scoring isolation

Each creator's scoring model is **independent by default**. Scores, feedback, and source
registries are scoped per-creator and never leak between accounts.

Creators can opt in to a centralized community weighting table with granular controls:
- **Community read**: blend aggregate community scores into rankings (configurable weight, default 20%, max 50%)
- **Community write**: contribute scoring data to the community pool (only aggregate stats are shared — no individual data exposed)

Read and write are independent toggles — any combination is valid.

## Infrastructure

- **Data store**: Cloudflare D1 (tables: `news_preferences`, `news_sources`, `community_source_scores`, `news_story_log`, `source_feedback`)
- **API**: BroadBanner gateway (`/v1/broad-news/*` endpoints)
- **MCP**: BroadBanner connector (`mcp.broadbanner.com/mcp`)
- **Webapp**: BannerBlast SPA route (`/app/bannerblast/news`)

## Setup

No environment variables required — authentication flows through the BroadBanner MCP connector's OAuth. The gateway endpoints are added to the existing BroadBanner gateway worker.

## Usage

```
"Aggregate news on Iran and nuclear talks"
"Run a news sweep for Ukraine"
"Generate 60-second scripts from the latest stories"
"Review my pending scripts"
"Approve and post that blurb with the video I uploaded"
"Push the Iran story key points to an article draft"
```
