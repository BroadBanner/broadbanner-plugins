---
name: episode-review
description: "Generate an episode review from a corrected podcast transcript. Use this skill whenever the user wants to create a show review, episode review, post-show writeup, or episode summary from a transcript. Also triggers when the user says 'write the review', 'generate the review', 'create the writeup', or when a corrected transcript is ready and the next pipeline step is needed. Determines review format and editorial voice automatically from show metadata tags."
---

# Episode Review

Generate a publication-ready episode review from a corrected transcript. This skill reads the show's metadata tags to determine the correct review format and editorial voice, loads only the relevant references, and produces the complete review document.

## When to use this skill

- A corrected transcript is ready and the user wants the review generated
- The user says "write the review" or "create the episode writeup"
- As the third step in the episode pipeline (after transcript-download and transcript-correction)

## What this skill does NOT do

This skill produces the review as a markdown file. It does not write to the Pages repo, create git commits, or open PRs. That's the job of the `pages-publish` skill.

## Inputs

| Input                     | Required    | Example                                     | Notes                                           |
| ------------------------- | ----------- | ------------------------------------------- | ----------------------------------------------- |
| Corrected transcript path | Yes         | `Social-Distribution/transcripts/.../IM_s1e25_forrest-page.txt` | Output of transcript-correction skill           |
| Pod ID                    | Yes         | `sotsp-im`                                  | Used to load show metadata and resolve all tags |
| Episode slug              | Yes         | `IM_s1e25_forrest-page`                     | Used for output filename                        |
| Publish date              | Recommended | `2026-03-31`                                | For SEO title. If unknown, use today's date.    |

If the user just ran the `transcript-correction` skill, these inputs are already known — carry them forward.

## Step-by-step workflow

### Step 1: Load show metadata and resolve tags

Resolve the workspace root (the directory containing `broadbanner.config.json` — walk up from CWD if needed) and read:

```
<workspace-root>/broadbanner.config.json
```

Look up `shows[<pod-id>]` and extract:

- `reviewFormat` → determines the structural template
- `editorialVoice` → determines tone and sourcing approach
- `displayName`, `seriesId`
- `host`, `commonHosts`
- `titleFormat` (for SEO title construction)
- `takeawayCountRange`
- `reviewLength`

**If the pod-id has no entry in `shows`:** list the pod-ids that are present and ask the user to confirm — or onboard the show via `banner-admin brand-watch --init <podcast-name>`.

### Step 2: Load references by tag

Load exactly two reference files based on the resolved tags:

```
episode-review/references/format-<reviewFormat>.md
episode-review/references/voice-<editorialVoice>.md
```

**If either file is missing:** STOP and report:

```
No reference found for tag '<tag-value>'.
Available formats: [list files matching references/format-*.md]
Available voices: [list files matching references/voice-*.md]
```

Do NOT load both format files. Do NOT load all voice files. Load only what the tags specify — this is the efficiency mechanism.

### Step 3: Read the corrected transcript

Read the full corrected transcript. The metadata header at the top (added by transcript-correction) gives you the guest name, episode identifier, and date.

Before generating the review, extract the spine of the episode as internal working notes (do not include these in the output):

- Core claim or purpose of the episode (1-2 sentences)
- 2-5 main themes discussed
- Turning points or key exchanges
- Calls to action stated by hosts or guests
- Direct quotes worth capturing (block quote candidates, pull quote candidates)

### Step 4: Generate the review

Follow both loaded references:

- **The format reference** controls structure: section order, required sections, length constraints, title format
- **The voice reference** controls tone: attribution style, editorial stance, sentence construction, what to avoid

Key principles that apply to all formats and voices:

**Extract the substance.** The review explains what happened, why it matters, and what listeners can do with it. Every paragraph earns its space.

**Quotes must be real.** Every block quote, pull quote, or attributed statement must come directly from the transcript. If the transcript is unclear, paraphrase and attribute by first name. Never invent.

**Honor the constraints:**

- Paragraph lengths per the format spec (and the show's `reviewLength` range)
- List items per the format spec (typically 2-5)
- Takeaway counts per the show's `takeawayCountRange`
- Title format exactly as specified by `titleFormat`
- Book linking policy: publisher > independent bookstore > thrift. No large tech company bookstores.

### Step 5: Save the output

Save the review to the episode-pipeline output location:

```
/tmp/episode-pipeline/<pod-id>_episode-review_<episode-slug>.md
```

Also save to the BroadBanner output directory if a workspace folder is available.

### Step 6: Report to the user

Present the key outputs:

- Link to the saved review file
- The SEO title and subtitle for quick confirmation
- The block quote (narrative/book-review formats) or the takeaway bullets (summary format) for a quality check
- Tags used: `reviewFormat: <value>`, `editorialVoice: <value>`
- Suggested next step: "The review is ready. You can now publish it to Pages."

## Output quality checks

Before delivering, verify:

- [ ] SEO title matches the required format from metadata
- [ ] Body meets the paragraph count and sentence count requirements for the loaded format
- [ ] Takeaway count (if applicable) is within the range from metadata
- [ ] All quotes come directly from the transcript
- [ ] No fabricated timestamps, sources, or events
- [ ] Lists are 2-5 items
- [ ] Book links (if any) follow the linking policy
- [ ] Social distribution copy is present (Substack, Bluesky, YouTube)
- [ ] The review could not describe a generic episode — it is specific to this one
- [ ] Editorial voice matches the loaded voice reference (check attribution style, stance, sentence patterns)

## Error handling

- **Transcript too short for meaningful review**: If the corrected transcript is under ~500 words, flag it to the user. The source may be incomplete.
- **Missing guest name in transcript header**: Ask the user. Don't guess — wrong attribution is worse than a placeholder.
- **Unknown pod-id**: List the pod-ids present in `<workspace-root>/broadbanner.config.json.shows` and ask the user to confirm.
- **Missing show metadata**: Tell the user to onboard the show via `banner-admin brand-watch --init <podcast-name>` (writes a YAML payload template to CWD); `banner-admin brand-watch` then writes the result to `broadbanner.config.json.shows[<pod-id>]`.
- **Unknown tag value**: List available reference files for that tag dimension. Don't fall back to a default — explicit is better than implicit.

## Extending the system

**New review format:** Create `references/format-<name>.md` with the structural specification. Use the new tag value in any show's metadata. No changes to this SKILL.md required.

**New editorial voice:** Create `references/voice-<name>.md` with the tone constraints. Use the new tag value in any show's metadata. No changes to this SKILL.md required.

**New tag dimension:** To add a third axis (e.g., `distribution-style` for how social copy gets written): add the tag to show metadata frontmatter, create a `references/<dimension>-<value>.md` file, and add a load step in Step 2. This is the only case that requires editing SKILL.md.

## Efficiency notes

The old pipeline (`ai-steps.ts createEpisodeReview`) loaded 5 files into a single system prompt: SYSTEM_PROMPT.md, OUTPUT_STANDARDS.md, SERIES_METADATA.md, 10_CREATE_POST_SHOW_REVIEW.md, and \_TEMPLATE_show_review.md. That's ~5,000+ tokens of context loaded for every single review, regardless of show format.

This skill reduces context by:

- **Tag-driven loading** — reads exactly 2 reference files (~300-400 words total) based on the show's declared format and voice, not a universal set
- **Metadata on demand** — only the single show file is loaded (~15 lines), not a full review guide
- **No redundant routing** — the old pipeline loaded the ROOT_DECISION_TREE.md + SYSTEM_PROMPT.md + OUTPUT_STANDARDS.md as universal context. This skill already knows what it's doing.
- **Expandable without bloat** — adding new formats or voices doesn't increase the context for existing shows
