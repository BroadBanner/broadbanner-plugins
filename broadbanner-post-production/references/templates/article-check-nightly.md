---
id: article-check-nightly-{{PROJECT_BASENAME}}
description: Check {{PROJECT_BASENAME}}'s article drafts nightly — an editorial pass on drafts with a requested editorial check, then an independent fact-check of requested and unchecked drafts, with notes and findings in the portal (nothing is edited or published).
cronExpression: 0 6 * * *
enabled: true
runLocation: any
---
<!-- Post-production (post_production_distribution): nightly second-agent editorial check (requested drafts only) + fact-check. No browser step, so it may run in the cloud. Runs after the 4:00 news prompt run so its drafts are checked the same morning. -->
You are running on a nightly ~6:00am (local time) schedule. Run two passes from the `broadbanner-post-production` plugin, both in **unattended Queue mode**: first the `editorial-check` skill, then the `fact-check` skill. This run is pre-approved to run autonomously — do NOT ask any questions and do NOT pause for confirmation.

## Runs anywhere (cloud OK)

This task uses only the **BroadBanner MCP connector** and web search. It opens no browser, reads no local files and needs no local credentials, so it can run in the cloud or on this computer. It is its own session, so every check it runs is independent of the chat that wrote the article.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on an account with the post-production add-on (`articles:read` + `articles:self-write`). If the `article_check_pack` tool isn't available, stop and report that in one line. If the connector's check tools don't accept `kind` (older connector), skip Pass 1 with one line and run Pass 2.

## What to do

### Pass 1 — Editorial (requested drafts only)

Editorial notes rewrite text, so they run before the fact-check (order: editorial → revise → fact-check on the final revision → publish). This pass only reviews drafts whose editorial check was **requested** in the portal; it never reviews unrequested drafts.

1. Call `article_checks { action: "queue", kind: "editorial", limit: 5 }`. **If the queue is empty, skip quietly** to Pass 2 ("No drafts awaiting an editorial check.").
2. For each article, one at a time, follow the `editorial-check` skill: load the personality (`get_persona { skill: "editorial-check", articleId }`, a silent skip without the add-on), build the pack (`article_check_pack { articleId, kind: "editorial" }`), read in the seven-lens order, and save (`article_check_save { kind: "editorial", … }`) with `mode: "requested"`. Every note needs a verbatim `articleQuote` and a fix; never rule on facts (file "Flag for fact-check" notes). On `bad_evidence`, recopy the quotes and retry once; on `stale_revision`, rebuild and re-check once. One article's failure never stops the others.

### Pass 2 — Fact-check

1. Call `article_checks { action: "queue", limit: 5 }`. **If the queue is empty, exit quietly** with one line ("No drafts awaiting a fact-check.") — the common case, not an error.
2. For each article, one at a time, follow the `fact-check` skill: build the pack (`article_check_pack`), run all six passes, and save (`article_check_save`) with `mode: "requested"` when it has `checkRequestedAt`, else `"scheduled"`. Follow every evidence rule in the skill; on `bad_evidence`, fix the quotes and retry once; on `stale_revision`, rebuild and re-check once. One article's failure never stops the others.

### Report

Finish with a short summary: for each pass, one line per article (editorial: title, open musts, total notes; fact-check: title, verdict, blocker/major counts), plus any left in either queue for the next run.

## Rules

- Never edit, revise or publish an article. Only save checks.
- The editorial pass judges whether a piece works; it never rules on facts. The fact-check pass ignores editorial notes.
- On any ambiguity, file fewer, better-evidenced findings and say what you could not verify in the check's summary.
