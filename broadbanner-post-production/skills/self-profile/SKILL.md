---
name: self-profile
description: "Draft or refresh the member's private self-profile (through-line, theses, recurring themes, personality, background, and a report for them) from ONLY their own published articles, posted news scripts, and what they said on shows they host or co-host, then get each section approved. Use when the user says '/self-profile', 'build my profile', 'what is my through-line', 'what are my themes', 'write a report on me', or 'update my profile'. The writing, post-production and news skills use the approved sections. Never approves on the member's behalf."
metadata:
  requiresTool: post_production_distribution
---
# Self-profile

A private profile of the member the writing team uses to keep their work on its
through-line. It lives in The Room → **You** (`app.broadbanner.com/app/room/you`), where the
member can approve, edit, lock or restore any section. Agents load only approved sections.

## Hard rules

- **Their own material only.** Read only what `self_profile sources` lists: articles they
  published, news scripts they posted, and transcripts of shows they host, including shows
  they co-host on someone else's series (`shared` on the item). Never a guest appearance,
  someone else's piece, the web, or what you assume about them. The server refuses evidence
  that cites anything else (422 `not_own_material`).
- **Only their own words in a transcript.** A transcript has other speakers. Read transcripts
  with `self_profile read`, which returns only the member's own turns, never
  `get_transcript`. Never draw on what a co-host or guest said. Evidence from a co-hosted
  transcript must quote the member's own turns verbatim (422 item `reason: not_own_words`
  otherwise). The transcript's owner can see that their transcript was read.
- **Every claim rests on their words.** Each section cites the pieces it comes from
  (`evidence[]`, with a short verbatim `quote` where one makes the point). If the material
  doesn't support a section, say so and leave it out. Don't fill it in.
- **The member decides.** `propose` only creates a suggestion. Call `decide` only after
  the member says so in this chat, for that section. Never propose a section they locked.
- **Describe, don't diagnose.** No guesses about health, politics they haven't stated,
  private life, motives or psychology. Write about the work and the voice.
- **Private.** Never paste the profile anywhere else or into a piece.

## Step 0 — Entitlement (no call)

If this connector has `self_profile`, carry on. If not, stop: "⚠️ The self-profile comes
with the **Production+** add-on and the Writing team. Nothing was changed."
(`../../references/preflight.md`.) A 403 `addon_required` on `propose` means the Writing
team add-on is off: say so and stop.

## Step 1 — Where it stands

`self_profile({ action: "get" })` → `sections[]` (current, proposed, locked), `settings`.
- Pending proposals from an earlier run → offer to review them first (Step 4).
- Locked sections → skip them. Say which you're skipping.
- "Update my profile" with current sections → you are refreshing: propose only what the
  newer material changes, and say what changed in `note`.

## Step 2 — Read their material

1. `self_profile({ action: "sources", limit: 50 })` → `items[]` (excerpts), `counts`,
   `nextOffset`. Page with `offset` until `nextOffset` is null or you have ~150 items.
2. Read in full the pieces that carry the most argument: up to ~12 articles
   (`get_article` with `ref.slug`), ~5 transcripts (`self_profile({ action: "read",
   transcriptId: ref.transcriptId })`, paged with `offset` until `nextOffset` is null), and a
   sample of scripts (`news_get_content` with `ref.contentId`). Prefer a spread across time,
   series and form over the newest only. A transcript with no turns attributed to the member
   (`total: 0`) can't be used: skip it. If it's one they saved themself, `note` says to read it
   with `get_transcript` and use only what they said.
3. Fewer than 3 pieces in all → stop and tell the member there isn't enough of their own
   work yet. Offer to let them write sections themselves in The Room → You.

## Step 3 — Draft

Write each section from what you read, in plain words, second person ("You keep coming
back to…"):

| key | What to write | Length |
| --- | --- | --- |
| `throughline` | The one idea their work returns to, in 1–3 sentences. | ≤ 1500 |
| `theses` | 3–7 arguments they make repeatedly, one line each, as they'd put it. | ≤ 3000 |
| `themes` | Recurring subjects and patterns, with where they show up. | ≤ 3000 |
| `personality` | Tone, rhetorical habits, what they push back on, what they care about. | ≤ 2500 |
| `background` | Experience they draw on, only as their own work states it. | ≤ 2500 |
| `report` | A short read for them: the arc of their work, where it's strongest, open threads and blind spots worth a look, and how the team will use this. | ≤ 8000 |

Each section except `report` needs at least one `evidence` item
(`{ kind, id, title, quote? }`, the `id` from `sources`). Up to 25 per section; quotes
≤ 300 characters, verbatim.

## Step 4 — Review with the member, one section at a time

For each drafted section:
1. `self_profile({ action: "propose", key, md, evidence, note })`. `note` = one line on
   what it rests on, or for a refresh what changed and why.
2. Show the member the section and the 2–3 strongest pieces behind it. Ask: approve, edit
   or skip?
3. Approve → `self_profile({ action: "decide", key, decision: "approve" })`; with their edits
   → add `md` with their wording. Skip → `decision: "reject"`. No answer → leave it pending;
   they can decide in The Room → You.

409 `locked` → skip that section. 422 `not_own_material` → drop each item it lists (reason
`not_own_material`, `excluded`, or `not_own_words` for a quote that isn't theirs), and
re-propose only if the section still stands on their own work.

If the member asks to leave a piece out of their profile (for example a co-hosted episode),
call `self_profile({ action: "exclude", sourceKind, sourceId, excluded: true })`; `false` puts
it back. They can do the same in The Room → You → Shows you co-host.

## Step 5 — Report

One short summary: sections approved / pending / skipped, how many of their pieces you
read, and the link `https://app.broadbanner.com/app/room/you`. Remind them which skills use
it (they can switch any off there) and that the fact-check never does.
