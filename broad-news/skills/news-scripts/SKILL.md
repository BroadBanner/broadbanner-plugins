---
name: news-scripts
description: "Generate video scripts and social blurbs from aggregated news stories. Use when the user says 'write the scripts', 'generate blurbs', 'create video scripts from the news', 'turn these stories into content', 'script this', or after news-aggregate has returned results. Produces 30-90 second video scripts (teleprompter-ready and outline) plus social blurbs with source links and hashtags. Respects the creator's configured writing style from BannerBlast. RATBAC-gated: requires the broad_news add-on."
metadata:
  requiresTool: broad_news
  version: "0.1.0"
---

# Script &amp; Blurb Generation

Transform aggregated news stories into production-ready content: teleprompter scripts for
30-90 second videos and social blurbs with source links and hashtags. This skill consumes
the output of `news-aggregate` and produces content ready for review in `news-manage`.

## Inputs

| Input           | Required | Example              | Notes                                              |
| --------------- | -------- | -------------------- | -------------------------------------------------- |
| `stories`       | Yes      | (from news-aggregate)| The structured story collection                    |
| `scriptLength`  | No       | `30`, `60`, `90`     | Target video length in seconds. Default `60`.      |
| `tone`          | No       | (from writing style) | Override tone. Default: creator's saved style.     |
| `hashtagCount`  | No       | `5`                  | Hashtags per blurb. Default `5`.                   |
| `platforms`     | No       | `["substack", "bluesky", "threads"]` | Target platforms. Default all three. |

## Step 0 — Load creator writing style

Call the BroadBanner gateway to retrieve the creator's configured writing style:

```
GET /v1/broad-news/style
Authorization: Bearer <gateway-token>
```

Response: `{ tone, vocabulary, avoidWords[], signaturePhrase?, hashtagStyle, scriptFormat }`

If no custom style exists, use defaults:
- `tone`: "direct, fact-first, urgent but not alarmist"
- `vocabulary`: "accessible — no jargon without explanation"
- `hashtagStyle`: "lowercase, no spaces, topical not branded"
- `scriptFormat`: "teleprompter"

## Step 1 — Select and cluster stories

From the aggregated stories, identify clusters (stories covering the same event from
different sources). For each cluster:

1. Identify the lead story (highest rank_score)
2. Collect supporting sources (other stories in the cluster)
3. Extract unique key points across all sources in the cluster
4. Note any factual discrepancies between sources

A single unclustered story is its own cluster of one.

## Step 2 — Generate video scripts

For each story cluster (or the top N if many), generate a video script.

### Teleprompter format

```
---
SCRIPT: [slug from headline]
LENGTH: ~[N] seconds ([word_count] words at 150 wpm)
SOURCES: [count] sources
---

[Opening hook — 1 sentence, grabs attention, states the core news]

[Context — 2-3 sentences, what happened and why it matters]

[Key detail — the most important specific fact, with attribution]
"According to [Source], ..."

[Implication — what this means going forward, 1-2 sentences]

[Close — call to action or forward look, 1 sentence]

---
SOURCES:
1. [Source name] — [URL]
2. [Source name] — [URL]
---
```

Word count targets:
- 30 sec → ~75 words
- 60 sec → ~150 words
- 90 sec → ~225 words

### Outline format

Also generate a bullet-point outline for creators who prefer to ad-lib:

```
OUTLINE: [slug]
- Hook: [one-liner]
- Context: [key background point]
- Detail: [specific fact + source]
- So-what: [implication]
- Close: [CTA or look-ahead]
Sources: [URLs]
```

## Step 3 — Generate social blurbs

For each story cluster, generate platform-appropriate blurbs:

### Substack Note
- No character limit (but keep under 500 chars for engagement)
- Can include line breaks for readability
- Include 1-2 source links inline
- Hashtags at end

### Bluesky
- 300 character limit
- Concise, punchy
- 1 link max (Bluesky shows link card)
- 2-3 hashtags

### Threads
- 500 character limit
- Slightly more conversational
- 1 link
- 3-5 hashtags

### Blurb template

```
[Core news in 1-2 sentences, creator's voice/tone]

[Source attribution with link]

[Hashtags]
```

### Hashtag generation rules

1. Always include the primary keyword as a hashtag
2. Add topical hashtags derived from the story content
3. Include 1 "reach" hashtag (broader category for discoverability)
4. Use the creator's `hashtagStyle` setting
5. Never use branded hashtags unless the creator configured them
6. Common patterns: #Iran #Ukraine #Geopolitics #ForeignPolicy #BreakingNews

## Step 4 — Package output

Return structured content ready for `news-manage`:

```json
{
  "generated": "2026-09-14T10:30:00Z",
  "scriptLength": 60,
  "items": [
    {
      "clusterId": "iran-nuclear-talks-sep14",
      "headline": "...",
      "script": {
        "teleprompter": "...",
        "outline": "...",
        "wordCount": 148,
        "estSeconds": 59
      },
      "blurbs": {
        "substack": { "text": "...", "hashtags": [...], "links": [...] },
        "bluesky": { "text": "...", "hashtags": [...], "links": [...] },
        "threads": { "text": "...", "hashtags": [...], "links": [...] }
      },
      "sources": [
        { "name": "Reuters", "url": "https://...", "domain": "reuters.com" }
      ],
      "keyPoints": ["...", "..."]
    }
  ]
}
```

This output is stored via the gateway and surfaced in the BannerBlast management page
for the creator to review, edit, approve, or delete.
