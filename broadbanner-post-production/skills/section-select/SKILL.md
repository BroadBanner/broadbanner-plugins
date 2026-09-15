---
name: section-select
description: "Assign a Substack draft to the correct publication section (series) before post-production — using the LIVE series title from the BroadBanner MCP connector, not a local config. Use when the Substack editor's toolbar reads 'Choose a section', when the user says 'set the section', 'file this under <series>', or 'select the section', or as the first browser step of the post-production chain (before transcript-download). Multi-section publications only; single-section publications have no dropdown and skip. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Section Select

Assign the Substack draft to the publication **section** that matches the resolved series,
so the post is filed under the right series before any downstream step (transcript
download, correction, review, publish). This is the connector-based successor to the
retired `broadbanner-episode-pipeline/section-select` skill, which matched the section
against `broadbanner.config.json shows[<pod-id>].displayName`. There is no local config
here — the match key is the **live `seriesTitle`** returned by `get_show_roster`.

## Why this skill exists

Substack publications that host multiple series (e.g. `sickofthis.substack.com`) use
sections to organize content. A live-recording draft lands in the publication root with
**no section assigned** — the editor toolbar shows a `Choose a section` button. Nothing
downstream sets it, so a review can be generated and published while the Substack post
itself stays unfiled. This skill closes that gap.

## When to skip

- **Single-section publications** — no `Choose a section` button in the toolbar. Report
  "No section selector — this publication doesn't use sections" and move on.
- **Section already correct** — the toolbar button already shows the resolved series
  title. Report it and move on.

## Step 0 — Entitlement preflight (advisory)

Same as every skill in this plugin: call `get_creator_context` and confirm
`post_production_distribution` ∈ `entitledTools` (or `isAdmin`) when the capability
fields are present; stop with the membership CTA if absent. When invoked by the
`post-production` orchestrator this has already run — don't repeat it.

## Inputs

| Input                   | Required | Example                                                  | Notes                                                                      |
| ----------------------- | -------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `draftUrl`              | Yes      | `https://sickofthis.substack.com/publish/post/215673973` | The Substack draft editor URL                                              |
| Resolved series context | Yes      | `{ seriesId, seriesTitle, brandId }`                     | From the orchestrator's Step 0 (`get_show_roster`). `seriesTitle` is the match key. |

If invoked standalone with only a URL and a typed series name, run the orchestrator's
Step 0 resolution first (`get_creator_context` → `get_show_roster` per series id →
match the typed name to a `seriesTitle`). **Never** match the dropdown against the raw
typed name — always against the connector's `seriesTitle`, which is what the Substack
section is named after.

## Single browser profile

All BroadBanner Substack browser skills run from the **single** connected Chrome profile
(profile routing was retired 2026-07-27). The operator must be logged into Substack in
that browser.

## Step-by-step workflow

### Step 1: Open the draft

`navigate` to `draftUrl`. Confirm the page is the Substack **post editor** (a title
field plus the formatting toolbar). If a login wall appears, stop and tell the user to
log into Substack.

### Step 2: Read the current section state

`find` the section selector in the secondary toolbar row (the row with the language
button, e.g. `🇺🇸 English ▾`, and `Email header / footer`). It is a button whose text is
either **`Choose a section`** or a section name.

- **`Choose a section`** → unassigned. Proceed to Step 3.
- **Already the resolved `seriesTitle`** (case-insensitive) → report
  "Section already set to `<seriesTitle>`" and stop.
- **A different section** → note the previous value and proceed to Step 3 to change it.

> Once a section is assigned, the button's accessible name is often **empty** —
> `find` / `read_page` may return it as "(unlabeled)". Its visible text is still the
> section name. If `find` can't locate a `Choose a section` button, `zoom` on the
> toolbar row (roughly the band just below the formatting toolbar) to read the label
> visually before concluding the publication has no sections.

### Step 3: Open the dropdown

Click the section button. A menu opens listing every section as a `menuitem`:

- The **publication name** first (the brand-level root, e.g. `Sick of this Shit
  Publications`) — never pick this for a series episode.
- One entry per series section (e.g. `Chronically Illing Out`, `Diogenes Club`,
  `Intelligent Masculinity`, …).

`find` "menuitem options in the open section dropdown" to collect them with refs.

### Step 4: Pick the matching section

Match `seriesTitle` against the menuitem texts:

1. **Exact, case-insensitive** equality after trimming whitespace — the normal case.
2. Fall back to a **unique containment** match (either direction) only if no exact match.
3. **No match** → close the menu (`Escape`), list the available sections, and stop:
   ```
   No section matching "<seriesTitle>" found on this publication.
   Available sections: <list>
   The series title in BroadBanner may not match the Substack section name — pick one,
   or rename the section / series so they agree.
   ```
   Never guess. Never select the publication-root entry as a fallback.
4. **Multiple containment matches** → list them and ask the operator which to use.

Click the matching menuitem.

### Step 5: Verify

Wait ~2s for autosave. Verify **visually** — `zoom` on the toolbar row and confirm the
button now shows the section name (with its section icon) instead of `Choose a section`.
Don't rely on the accessible name here (see the note in Step 2).

### Step 6: Report

```
Section set: <seriesTitle>   (was: Choose a section | <previous section>)
Draft: <draftUrl>
```
Then hand off: "Section set. Next: transcript-download."

**Carries forward:** nothing new — the resolved series context passes through unchanged.

## Error handling

- **Editor didn't load / login wall:** stop; ask the user to log into Substack in the
  connected browser.
- **No section button at all:** the publication is single-section — skip (not an error).
- **Match failure:** handled in Step 4 — list the options and stop; do not pick the root.
- **Selection didn't stick** (toolbar still says `Choose a section` after Step 5): retry
  Steps 3–4 once; if it still fails, screenshot and ask the user.

## Worked example (2026-09-15)

Draft `sickofthis.substack.com/publish/post/215673973`, title
`Chronically Illing Out | E47 - Recouping and Starting Our Week`, toolbar read
`Choose a section`. Dropdown: `Sick of this Shit Publications`, `Chronically Illing Out`,
`Diogenes Club`, `Intelligent Masculinity`, `Listening Louder`, `Powerful Voices`,
`Time for Life`, `Sick of this Show`, `Notes of the Week`. Resolved
`seriesTitle = "Chronically Illing Out"` matched exactly; after the click the toolbar
showed the section icon + `Chronically Illing Out`.
