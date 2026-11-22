# Linked content: the refresh pass after every article save

An article can have **linked content**: the BroadNews scripts made for it, each with its own blurbs and
teleprompter text, and the article's **own blurbs** (`socialCopy`). Since 2026-11-22 the server flags
that content whenever the article gets a new revision. The flag is set whether the change came from you,
another skill, a check fix or the member's own edit in the WebApp. A flagged script can't be approved
or posted until someone looks at it. Your job is to look at it **without being asked**, so the member
never reads or posts something the article no longer says.

## When

Right after any save that changed the article's text: `update_article`, a `news_create_article` revise
(`articleId`), or a check-fix revision. The save result carries `refreshLinked` when something is
behind. No `refreshLinked` means nothing is linked or everything is in step, so skip this.
`get_article` returns the same block, so a nightly run can find work the member left after editing in
the WebApp.

## The pass

`refreshLinked` lists `scripts[]` (each with `state` and `label`), `socialCopyStale` and a `summary`.

1. **Scripts with `state: needs_review`.** For each one, `news_get_content { itemId }`, then compare
   its headline, teleprompter script, outline, key points and every blurb with the article's
   **new** text.
   - Something it says changed (a figure, a name, a claim, the framing a fix softened): rewrite
     **only** what changed with `news_manage_content { itemId, action: "edit", edits: { … } }`. Keep
     the script's length, voice and story order. Never add a fact the article doesn't support.
   - Nothing it says is affected: `news_manage_content { itemId, action: "edit", edits: {
     acknowledgeArticleChange: true } }`.
   - Either way it stays **pending**: the member approves it. Never pass `approve: true`.
2. **The article's own blurbs** (`socialCopyStale` set). `get_article`, then fix the affected wording
   with `update_article { id, socialCopy, revisionNote }`. Send the **full** object and keep each
   platform's shape. If nothing is affected, send `update_article { id, acknowledgeSocialCopy: true }`.
   This is allowed for a sourced article: only its body must go through `news_create_article`.
3. **Scripts with `state: posted_before_change`** already went out. Don't edit them. Name each one in
   your report ("went out before revision 4") and offer a correction post. Draft one only if the
   member asks, and never post it yourself.

Who writes: the article's blurbs are Ki's. Scripts are Bucky's. In a chat where only Ki is loaded and
the add-on is on, load Bucky for the script rewrites with `team_session { personalities: ["bucky"] }`.
Without the add-on, do the pass in the skill's own voice.

## Report

One line per item: "Script 'Lead story': updated the turnout figure (pending your approval)", "Script
'Also today': no change needed", "Blurbs: updated Bluesky and Threads". Then the `summary` items still
open, if any.

## Never

- Approve, post, publish or change a status. The member approves the refreshed drafts in The Room →
  News (scripts) or the article page (blurbs).
- Leave a script you know is wrong and tell the member to fix it in the editor.
- Rewrite a script that isn't flagged because you happen to be there. Only flagged items, only what
  changed.
