---
id: article-check-nightly-{{PROJECT_BASENAME}}
description: Fact-check {{PROJECT_BASENAME}}'s article drafts nightly — requested and unchecked drafts get an independent check with findings in the portal (nothing is edited or published).
cronExpression: 0 6 * * *
enabled: true
runLocation: any
---
<!-- Post-production (post_production_distribution): nightly second-agent fact-check. No browser step, so it may run in the cloud. Runs after the 4:00 news prompt run so its drafts are checked the same morning. -->
You are running on a nightly ~6:00am (local time) schedule. Invoke the `fact-check` skill from the `broadbanner-post-production` plugin in **unattended Queue mode**. This run is pre-approved to run autonomously — do NOT ask any questions and do NOT pause for confirmation.

## Runs anywhere (cloud OK)

This task uses only the **BroadBanner MCP connector** and web search. It opens no browser, reads no local files and needs no local credentials, so it can run in the cloud or on this computer. It is its own session, so every check it runs is independent of the chat that wrote the article.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on an account with the post-production add-on (`articles:read` + `articles:self-write`). If the `article_check_pack` tool isn't available, stop and report that in one line.

## What to do

1. Call `article_checks { action: "queue", limit: 5 }`. **If the queue is empty, exit quietly** with one line ("No drafts awaiting a fact-check.") — the common case, not an error.
2. For each article, one at a time: build the pack (`article_check_pack`), run all six passes, and save (`article_check_save`) with `mode: "requested"` when it has `checkRequestedAt`, else `"scheduled"`. Follow every evidence rule in the skill; on `bad_evidence`, fix the quotes and retry once; on `stale_revision`, rebuild and re-check once. One article's failure never stops the others.
3. Finish with a short summary: one line per article (title, verdict, blocker/major counts), plus any left in the queue for the next run.

## Rules

- Never edit, revise or publish an article. Only save checks.
- On any ambiguity, file fewer, better-evidenced findings and say what you could not verify in the check's summary.
