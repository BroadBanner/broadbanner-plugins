---
id: article-check-nightly-{{PROJECT_BASENAME}}
description: Check {{PROJECT_BASENAME}}'s article drafts nightly — an editorial pass on drafts with a requested editorial check, then an independent fact-check (held while editorial musts are open), with notes, findings and votes on research-lead disputes in the portal (nothing is edited or published).
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

1. Call `article_checks { action: "queue", kind: "editorial", limit: 5 }`. **If the queue is empty, skip quietly** to Pass 2 ("No drafts awaiting an editorial check."). The nightly BroadNews prompt run requests this check on every draft it writes, so Mo always reads those first.
2. For each article, one at a time, follow the `editorial-check` skill: load the personality (`get_persona { skill: "editorial-check", articleId }`, a silent skip without the add-on), build the pack (`article_check_pack { articleId, kind: "editorial" }`), read in the seven-lens order, and save (`article_check_save { kind: "editorial", … }`) with `mode: "requested"`. Every note needs a verbatim `articleQuote` and a fix; never rule on facts (file "Flag for fact-check" notes). On `bad_evidence`, recopy the quotes and retry once; on `stale_revision`, rebuild and re-check once. One article's failure never stops the others.
3. **Mo votes** (see "Votes on disputes" below) once the editorial check is saved.

### Pass 2 — Fact-check

1. Call `article_checks { action: "queue", limit: 5 }`. **If the queue is empty, exit quietly** with one line ("No drafts awaiting a fact-check.") — the common case, not an error.
2. **Hold Bruce while Mo's musts are open.** For each article, first `article_checks { action: "list", articleId, view: "open" }`. If `nextStep.step` is `address_editorial`, skip it with one line ("held for Ki: N open musts"): the draft is about to change, so a fact-check now would be wasted. Ki revises at 7:00 and Bruce checks the revision at 8:00 (when those BroadNews tasks are installed).
3. For each remaining article, one at a time, follow the `fact-check` skill: build the pack (`article_check_pack`), run all six passes, and save (`article_check_save`) with `mode: "requested"` when it has `checkRequestedAt`, else `"scheduled"`. Follow every evidence rule in the skill; on `bad_evidence`, fix the quotes and retry once; on `stale_revision`, rebuild and re-check once. One article's failure never stops the others.
4. **Bruce votes** (below) once the fact-check is saved.

### Votes on disputes (drafts written from a research lead)

Ki and Bucky's nightly research can leave **disputes** on the draft's research lead. Each checker votes **only after their own check on that article is saved**, so the check stays independent of the argument. Skip silently when the connector has no `research_leads` tool.

1. `research_leads { action: "list", articleId }` → the lead (none → nothing to vote on).
2. For each dispute that's `open` and has no vote from you yet, read both positions and the evidence each cites (open what you need: stories, library sections, primary records), then:
   `research_leads { action: "vote", leadId, disputeId, personality: "mo" | "bruce", side: "ki" | "bucky" | "not_enough_evidence", text: "<reason, citing the evidence>" }`.
   Mo weighs fairness, proportion and whether the claim is earned; Bruce weighs the record. Judge only on evidence; "not enough evidence" is a fine answer.
3. Never pick a winner for the person, and never edit the draft.

### Report

Finish with a short summary: for each pass, one line per article (editorial: title, open musts, total notes; fact-check: title, verdict, blocker/major counts or "held for Ki"; votes cast), plus any left in either queue for the next run. When BroadNews is installed, use the format of the `broad-news` plugin's `references/morning-report.md` for drafts written from a lead, with "Ki changed: pending (7:00)" when Ki has work to do.

## Rules

- Never edit, revise or publish an article. Only save checks.
- The editorial pass judges whether a piece works; it never rules on facts. The fact-check pass ignores editorial notes.
- On any ambiguity, file fewer, better-evidenced findings and say what you could not verify in the check's summary.
