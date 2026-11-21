---
id: library-monthly-recheck
description: Reference library, monthly check (the 1st) — re-captures your browser-captured .mil/.gov documents and lists articles whose cited section changed (nothing is edited or published).
desk: library
replaces: reference-recheck-monthly
cronExpression: 30 7 1 * *
enabled: true
runLocation: local
---
<!-- Post-production (post_production_distribution): reference library Phase 2 (Data mig 0136). Needs the browser because .mil sites refuse servers, so it runs on this computer. -->
You are running on a monthly schedule (the 1st, ~7:30am local time). Invoke the `reference-library` skill from the `broadbanner-post-production` plugin and follow its **Check for changes (monthly)** section. This run is pre-approved to run autonomously — do NOT ask questions and do NOT pause for confirmation.

## ⚠️ Local machine only — needs the browser

.mil sites refuse servers and plain HTTP, so documents captured through the browser are re-checked by opening the official site in the connected Chrome. Documents BroadBanner can fetch itself are re-checked server-side every night and need nothing here.

## Prerequisites

- The **BroadBanner MCP connector** (`https://mcp.broadbanner.com/mcp`) connected, on an account with the post-production add-on. If `reference_list` isn't available, stop and report that in one line.
- The operator's Chrome connected (Claude in Chrome). If it isn't, list the documents that are due and stop.

## What to do

1. `reference_list { action: "recheck" }`. If nothing is due with `via: "browser"`, skip to step 3.
2. For each `via: "browser"` document, one at a time: `reference_upload_ticket` with the document's `officialUrl` (and its short name), open the page the steps name in a new tab, run the returned `browserScript` unchanged with the javascript tool, and note the result (`duplicate: true` = unchanged; `duplicate: false` = a new version, now being read). One document's failure never stops the others. Close the tabs you opened.
3. `reference_citations { action: "alerts" }`.

## Report

One line per document checked (short name: unchanged / new version / failed and why), then one line per alert (article title, section, changed or removed, cited version → current version). Do not acknowledge alerts; the member does that after reading them.

## Rules

- Never edit an article or the shared document text. Only capture from the official URL.
- Never capture from a mirror or any non-.mil/.gov host.
