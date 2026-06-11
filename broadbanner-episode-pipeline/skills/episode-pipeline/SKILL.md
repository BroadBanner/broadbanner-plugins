---
name: episode-pipeline
description: "Run the full episode pipeline from Substack post to published Pages review. Use this skill when the user says 'run the pipeline', 'process this episode', 'full pipeline', or provides a Substack post URL and wants the complete flow: section select, transcript download, transcript correction, episode review, and pages publish. Can also resume from any intermediate step."
---

# Episode Pipeline

Run the complete episode-processing chain from a Substack post URL to a published review on the BroadBanner Pages site. This skill orchestrates five individual skills in sequence, passing outputs forward as inputs.

## When to use this skill

- The user wants to process a new episode end-to-end
- The user says "run the pipeline," "process this episode," "full pipeline on [URL]"
- A Substack post URL is provided and the user wants everything handled
- The user wants to resume the pipeline from a specific step

## What this skill does

This skill does not contain processing logic itself. It coordinates the execution of five standalone skills in order, carrying context between them. Each skill has its own `SKILL.md` with full documentation — read that skill's instructions when you reach its step.

## Inputs

| Input              | Required      | Example                                                  | Notes                                                                                                                              |
| ------------------ | ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Substack post URL  | Yes           | `https://sickofthis.substack.com/publish/post/192891809` | The editor URL for the episode post                                                                                                |
| Pod ID             | Yes           | `sotsp-tfl`                                              | Identifies the show. Determines section name, transcript path, review format, voice, and Pages directory                           |
| Episode identifier | Conditional   | `S1E03`, `Book 4 E6`, `courage-candidate-keira-havens`   | Season/episode or book/episode number for season/book modes; episode-title slug for episodic mode (no S/E or Book/E numbering)     |
| Episode date       | Recommended   | `2026-04-03`                                             | For filenames and SEO titles. Required for episodic mode (drives the index entry's date suffix). Defaults to today if not provided |
| Guest name(s)      | If applicable | `Forrest Page`                                           | Required for interview shows (IM). Not needed for panel shows                                                                      |
| Start from step    | No            | `3`                                                      | Resume from a specific step (1-5). Default: 1                                                                                      |
| Create PR          | No            | `true`                                                   | Whether pages-publish should create a GitHub PR. Default: false                                                                    |

**Identifier shape by `seasonBookMode`:**

- `season` — `S{N}E{N}` (e.g. `S1E03`)
- `book` — `Book {N} E{N}` (e.g. `Book 4 E6`)
- `episodic` — the kebab-case episode-title slug (e.g. `courage-candidate-keira-havens`); there is no S/E numbering and no per-season/per-book grouping

## Pipeline steps

### Step -1: Ensure BroadBanner mount

Before loading any metadata or running any sub-skill, verify the host `~/BroadBanner` directory is mounted at `/sessions/*/mnt/BroadBanner`. If not, call `mcp__cowork__request_cowork_directory` with `path: "~/BroadBanner"`. The entire pipeline reads and writes files inside the host BroadBanner tree (Pages, Social-Distribution) — without the mount, nothing works. If the mount call fails, stop immediately and report.

### Step 0: Load show metadata

Before running any skill, read the show metadata to have all context available. Resolve the workspace root (the directory containing `broadbanner.config.json` — walk up from CWD if needed), then read:

```
<workspace-root>/broadbanner.config.json
```

Look up `shows[<pod-id>]` and extract the fields you'll carry forward through all steps:

- `displayName` — Substack section name (for section-select)
- `reviewFormat` — structural template tag (for episode-review)
- `editorialVoice` — tone tag (for episode-review)
- `seriesId`, `host`, `commonHosts`, `seasonBookMode`, `titleFormat`, `reviewLength`, `takeawayCountRange`

Also read `<workspace-root>/pod-map.json` and look up the entry for `<pod-id>` to get the `brand` and `podcast` directory names plus the Substack domain. The transcript filename prefix is `seriesId` from `shows[<pod-id>]`.

**If the pod-id has no entry in `broadbanner.config.json.shows`:** STOP and tell the user: "This show isn't onboarded yet. Run `banner-admin brand-watch --init <podcast-name>` from CWD — it scaffolds a YAML payload template; fill it in and `banner-admin brand-watch` will write the result to `broadbanner.config.json.shows[<pod-id>]`."

### Step 1: Section Select

**Skill:** `Skills/section-select/SKILL.md`

**Purpose:** Assign the Substack post to the correct publication section.

**When to skip:**

- The publication has only one section (single-show publications like `fp-fr`, `twv-ew`)
- The section is already correctly assigned (button already shows the right name)

**Procedure:**

1. Navigate to the Substack post URL in the browser
2. Read the section selector button — if it already shows the correct `displayName`, skip
3. Click "Choose a section" to open the dropdown
4. Find and click the menuitem matching the `displayName` field from `shows[<pod-id>]`
5. Confirm the button updated

**Carries forward:** The browser is now on the Substack editor page (needed for Step 2).

### Step 2: Transcript Download

**Skill:** `Skills/transcript-download/SKILL.md`

**Purpose:** Download the raw transcript `.txt` file from the Substack post.

**Procedure:**

1. On the Substack editor page (from Step 1, or navigate to the URL)
2. Click the scissors/transcript icon to open the transcript panel
3. Click the "..." menu, then "Download .txt"
4. Save the downloaded file to the correct transcripts directory (see `transcript-download/SKILL.md` Step 1 for the per-mode rules):
   ```
   # season-based
   Social-Distribution/transcripts/<brand>/<podcast>/season-<NN>/<PREFIX>_<episode-slug>.txt
   # book-based
   Social-Distribution/transcripts/<brand>/<podcast>/book-<NN>/<PREFIX>_<episode-slug>.txt
   # episodic (no season/book grouping)
   Social-Distribution/transcripts/<brand>/<podcast>/episodes/<PREFIX>_<episode-slug>.txt
   ```
5. Confirm the file exists and has content

**Carries forward:** Transcript file path, raw line count, episode slug. For season/book shows the slug encodes the identifier (e.g. `s1e26-angry-male-vet`, `book4-e07-2026-04-10`); for episodic shows the slug is the kebab-case episode title (e.g. `courage-candidate-keira-havens`).

### Step 2.5: Video Download

**Skill:** `Skills/video-download/SKILL.md`

**Purpose:** Download all Substack-generated clips for this episode, deduplicate against existing Restream clips, stage locally, and queue for R2 upload and social distribution.

**When to skip:**

- The user passed `--skip-video` or confirmed there is no video on this post
- The Substack post has no video (audio-only episode)

**Procedure:**

1. Pass the episode slug (from Step 2 transcript filename) as `episode_slug`
2. Follow `Skills/video-download/SKILL.md` in full
3. Each unique clip is staged to `BroadBanner/media/<clip-id>.mp4`, a tracker JSON is written to `Social-Distribution/`, and `banner-blast push` is called per clip
4. Skipped clips (Restream duplicates) are logged but do not block the pipeline

**Carries forward:** List of staged clip IDs and their tracker paths (for reference only — downstream steps do not depend on clip data).

### Step 3: Transcript Correction

**Skill:** `Skills/transcript-correction/SKILL.md`

**Purpose:** Clean the raw transcript — fix known errors deterministically, then apply AI corrections for speaker attribution, readability, and structure.

**Procedure:**

**Phase 1 — Deterministic pass:**

1. Run the corrections script against the raw transcript using the corrections dictionary at `Skills/transcript-correction/references/corrections-dictionary.json`
2. Report the substitution count

**Phase 2 — AI correction pass:**

1. Load show metadata for the header (Series Name, ID, Hosts, Mode)
2. Read the pre-corrected transcript
3. Apply speaker attribution using host names from metadata + any guest names provided
4. Fix punctuation, capitalization, run-on passages
5. Add the metadata header
6. Save the corrected transcript (overwrites the raw file)

**Phase 3 — Dictionary update:**

1. Check for new misspellings discovered during the AI pass
2. Add any new entries to the corrections dictionary
3. Report additions

**Carries forward:** Corrected transcript file path, speaker names confirmed, any flagged sections.

### Step 4: Episode Review

**Skill:** `Skills/episode-review/SKILL.md`

**Purpose:** Generate a publication-ready episode review from the corrected transcript.

**Procedure:**

1. Load the two tag-resolved reference files:
   - `Skills/episode-review/references/format-<review-format>.md`
   - `Skills/episode-review/references/voice-<editorial-voice>.md`
2. Read the corrected transcript
3. Extract the episode spine (themes, turning points, quotes)
4. Generate the review following both format and voice references
5. Save to: `Skills/episode-review/output/<pod-id>_episode-review_<episode-slug>.md`

**Carries forward:** Review file path, SEO title, block quote or takeaways for confirmation.

### Step 5: Pages Publish

**Skill:** `Skills/pages-publish/SKILL.md`

**Purpose:** Format the review for Jekyll, write it to the Pages repo, update the index, and optionally create a PR.

**Procedure:**

1. Resolve the Pages path: brand and podcast directory names come from `<workspace-root>/pod-map.json`; filename and index conventions are documented in `Skills/pages-publish/references/pages-conventions.md`
2. Read and validate the review (SEO title, subtitle, body section present)
3. Format as Jekyll markdown using `Skills/pages-publish/references/pages-format.md`
4. Check for existing file at the target path
5. Write the file to Pages
6. Update the series `index.md` with the new entry
7. Git commit (and optionally create a branch + PR)
8. Save social distribution copy separately

**Carries forward:** Pages file path, index entry, commit hash or PR URL, social copy path.

## Resuming from a step

If the user says "start from step 3" or "resume from correction," skip the earlier steps and pick up the chain. You'll need the outputs from prior steps:

| Resume from         | What you need                                                 |
| ------------------- | ------------------------------------------------------------- |
| Step 2 (download)   | Browser on the Substack editor page, or the URL               |
| Step 3 (correction) | Transcript file path under `Social-Distribution/transcripts/` |
| Step 4 (review)     | Corrected transcript file path                                |
| Step 5 (publish)    | Review file path from episode-review output                   |

If a required input is missing, check the expected file paths based on the pod-id and episode identifier. If the file exists, use it. If not, ask the user.

## After the pipeline completes

Report the full pipeline summary:

```
Pipeline complete for <pod-id> — <episode identifier>

Section:     <section name> (set/already set/skipped)
Transcript:  <transcript file path> (<line count> lines)
Corrections: Phase 1: <N> deterministic fixes, Phase 2: speaker attribution + cleanup
Review:      <review file path> (format: <review-format>, voice: <editorial-voice>)
Pages:       <pages file path>
Index:       <entry added / already indexed>
Social copy: <social copy file path>
Git:         <commit hash or PR URL>

Next: Review the published page after GitHub Pages deploys, then distribute using the social copy.
```

## Error handling

- **Unknown pod-id:** Stop early and point to the onboarding template
- **Step failure:** If any step fails, report which step failed and why. The user can fix the issue and resume from that step using `start from step N`
- **Browser not available:** Steps 1 and 2 require browser automation. If the browser is not connected, report: "Steps 1 and 2 need browser access. Run section-select and transcript-download manually, then resume from step 3."
- **Transcript too short:** If the downloaded transcript is under 100 lines, warn the user — the download may have failed or the episode may be very short

## Onboarding a new show

If the user wants to run the pipeline for a pod-id that doesn't exist yet, point them to the onboarding checklist:

1. Run `banner-admin brand-watch --init <podcast-name>` from CWD — this writes a YAML payload template. Fill it in (`displayName`, `host`/`commonHosts`, `seriesId`, `reviewFormat`, `editorialVoice`, `seasonBookMode` — one of `season` | `book` | `episodic`, `reviewLength`, `takeawayCountRange`, `titleFormat`).
2. Run `banner-admin brand-watch` — it picks up the payload and writes it to `<workspace-root>/broadbanner.config.json` under `shows[<pod-id>]`.
3. Add the pod-id entry to `<workspace-root>/pod-map.json` (brand directory, podcast directory, Substack domain).
4. Create `Pages/<brand>/<podcast>/episode-reviews/index.md` with empty Jekyll frontmatter.
5. Add host names to `Skills/transcript-correction/references/corrections-dictionary.json`.
6. If using a new review format or voice, create the reference files in `Skills/episode-review/references/`.
