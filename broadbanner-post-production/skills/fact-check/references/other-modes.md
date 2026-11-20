# Fact-check — Scripts, ad-hoc claims, queue mode, nightly task

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Script check (BroadNews `news_content`)

Same passes, shorter: 1–4 and 6 in full; pass 5 becomes **one-sidedness** (does the
script present a contested claim as settled?). Use `news_content_check_pack({ contentId })`
(paragraph 0 = headline, then the teleprompter paragraphs, outline, key points and each
blurb) and save with `news_content_check_save({ contentId, version: pack.target.version,
… })`. Scripts carry no `[n]`, so every stored story is a source for every paragraph.
The pack's `references[]` holds the library documents the script cites (sections' text,
citation, page link): check every rule the script states against that text, and run
`reference_verify_quote` with `articleId: contentId, articleKind: "news_content"` on every
quoted rule (same severities as an article). Report before the creator approves the script.

## Ad-hoc claims (no save target)

For claims the user pastes (a paragraph, a quote, a list of figures, a social post or a
URL) that are not a portal article or a BroadNews script:

1. Number the text as paragraphs (0 = a headline if there is one) and break it into
   atomic claims (pass 1).
2. Run passes 2–6 on each claim. There is no evidence pack: find sources with
   `news_search_stories` / `news_get_story`, `news_primary_search` /
   `news_primary_capture`, `data_series`, `search_archive`, and web search. Every hard
   rule of evidence applies; quote what you rely on verbatim, with its URL or story id.
3. **Save nothing.** There is no `article_check_save` and no portal panel. Do not create
   an article to hold the check.
4. Report as in Step 6 with the verdict line "unsaved, ad-hoc" and a per-claim result:
   supported · partial · unsupported · contradicted · could not verify (say why, e.g. a
   429). "Could not verify" is a legitimate result.

The fresh-chat rule still applies if this chat wrote the text being checked.

## Queue mode (nightly or "check everything waiting")

1. `article_checks({ action: "queue", limit: 5 })`: requested drafts first, then recent
   drafts whose latest revision is unchecked.
2. For each (at most 5 per run; the rest stay queued), run Step 0.5 with its
   `articleId` (each article may resolve a different brand's Bruce), then Steps 1–5 with
   `mode: "requested"` if it has `checkRequestedAt`, else `"scheduled"`. Never skip the
   evidence rules to go faster.
3. Unattended (scheduled task): **ask no questions**. If an article can't be checked
   (missing, forbidden, repeated `bad_evidence`), note it and continue.
4. Finish with one line per article: title, verdict, blocker/major counts.

The fresh-chat rule is satisfied by construction: the scheduled task is its own session.

## Nightly task

Installs `article-check-nightly-` + project, which runs an editorial pass on drafts with a
requested editorial check (`editorial-check` Queue mode) and then this skill's Queue mode every day at 6:00
local time (after the 4:00 news prompt run), with no browser, so it can run in the cloud.

1. Resolve this plugin's templates directory: `references/templates/` at the plugin root
   (`../../references/templates` relative to this skill). Capture its absolute path as
   `PP_TEMPLATES`.
2. Invoke **`bb-scheduled-manager`** (plugin `broadbanner-scheduled-tasks`) with the
   **`install`** action, scaffolding from `PP_TEMPLATES`:
   `node` + the engine's `scripts/collect-tasks.mjs --project PROJECT --templates-dir "$PP_TEMPLATES" --scaffold`.
   To change the time, edit the scaffolded spec's `cronExpression` before it registers.
3. If `broadbanner-scheduled-tasks` isn't installed, tell the user to add it first.

To remove it, invoke `bb-scheduled-manager` **uninstall** for that task only.
