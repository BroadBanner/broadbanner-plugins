---
name: pages-publish
description: "Publish an episode review to the BroadBanner Pages repo. Use this skill when the user wants to publish a review, push to Pages, write to the site, or when the episode-review skill has just completed and the review is ready for publishing. Handles Jekyll formatting, index.md updates, branch + commit, and automated GitHub PR creation (this replaces the legacy `broadbanner episode-pr` CLI command)."
---

# Pages Publish

Convert a completed episode review into a Jekyll-ready markdown file, write it to the Pages repo, update the series index, commit the changes on a feature branch, push the branch, and open a GitHub PR. This is the final step in the episode pipeline.

The PR is the default — there is no "commit and forget" path unless the user explicitly opts out (`Skip PR = true`). This replaces what used to be a separate `broadbanner episode-pr` CLI invocation after publishing.

## When to use this skill

- The `episode-review` skill has just completed and the user wants to publish
- The user says "publish it," "push to Pages," "write it to the site," or "create the PR"
- A review markdown file exists and the user wants it in the Pages repo

## What this skill does NOT do

This skill does not generate the review content. That's the job of `episode-review`. This skill takes an existing review markdown file and publishes it.

## Inputs

| Input            | Required | Example                                                                  | Notes                                                                                                                                                                             |
| ---------------- | -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review file path | Yes      | `/tmp/episode-pipeline/sotsp-im_episode-review_IM_s1e25_forrest-page.md` | Output of episode-review skill                                                                                                                                                    |
| Pod ID           | Yes      | `sotsp-im`                                                               | Determines Pages directory path and index format                                                                                                                                  |
| Episode slug     | Yes      | `s1e25-forrest-page`                                                     | Used for the filename in Pages. For episodic-mode shows (no season/book grouping), this is just the kebab-case episode title — e.g. `courage-candidate-joseph-perez-caputo-ct04`. |
| PR draft         | No       | `true`                                                                   | If true, the PR is created as a draft. Default: `false` (PR is opened ready-for-review).                                                                                          |
| Skip PR          | No       | `true`                                                                   | Escape hatch: if `true`, commit directly to the current branch and skip the PR step entirely. Default: `false`. Use only when the user explicitly asks not to open a PR.          |

If the user just ran the `episode-review` skill, all inputs are already known — carry them forward. The default flow always creates a branch + PR; only override that if the user explicitly asks for a no-PR commit.

## Step-by-step workflow

### Step 1: Load show metadata and resolve paths

Resolve the workspace root (the directory containing `broadbanner.config.json` — walk up from CWD if needed). Read `<workspace-root>/broadbanner.config.json` and look up `shows[<pod-id>]`. Extract:

- `displayName`, `seriesId`
- `host`, `commonHosts` (the primary host is used for the signature line)
- `seasonBookMode` (determines index entry format)

Read `<workspace-root>/pod-map.json` and look up the entry for `<pod-id>` to get the `brand` and `podcast` directory names.

Resolve the Pages directory path (see `references/pages-conventions.md` for filename and index conventions):

```
Pages/<brand>/<podcast>/episode-reviews/
```

Determine the output file path:

```
Pages/<brand>/<podcast>/episode-reviews/<episode-slug>.md
```

**If the pod-id has no entry in `pod-map.json` or `broadbanner.config.json.shows`:** list available pod-ids from `pod-map.json` and ask the user to confirm — or onboard the show via `banner-admin brand-watch --init <podcast-name>`.

### Step 2: Read and validate the review

Read the review markdown file produced by `episode-review`.

Validate that it contains the minimum required fields:

- `**SEO Title:**` — must be present
- `**Subtitle:**` or `**Pages H2:**` — at least one must be present
- A body section under an H3 header — must be present and non-empty

Also extract from the review:

- SEO Title → used to build the H1 (strip the trailing date)
- Pages H2 or Subtitle → used for the H2
- Block quote text and attribution (if present)
- Review section header (the H3, e.g., "Masculinity In Review")
- Body content (everything under the review H3 until the next section)
- Books Mentioned section (book-review format only)
- Sources & References section (if present)
- Social distribution copy (preserved in a separate output, not written to Pages)

**If validation fails:** STOP and report exactly what's missing. Don't attempt to publish a partial review.

### Step 3: Format the Jekyll Pages file

Load `references/pages-format.md` for the exact output structure.

Build the Pages file following the format for this show's `reviewFormat` value (from `broadbanner.config.json.shows[<pod-id>]`):

1. **Empty frontmatter:** `---\n---`
2. **H1 title:** Built from SEO title with the trailing date stripped
3. **H2 subtitle:** From Pages H2 field (preferred) or Subtitle field
4. **Substack episode link** (summary format only): H5 with link to the full episode
5. **Block quote** (narrative and book-review formats): Formatted with `>` prefix and `_\~ Name \~_` attribution
6. **Review section header:** H3 with the appropriate header for this show
7. **Body content:** Directly from the review, preserving paragraph structure
8. **Books Mentioned** (book-review format only): Carried through from review
9. **Additional sections** (summary format): Key Takeaways, People/Orgs/Terms, Sources — each separated by `---`
10. **Host signature:** `\~ [{Host Name}]({host-url})` or `\~ {Host Name(s)}`
11. **Closing separator:** `---`

**Critical:** Do not add content that wasn't in the review. Do not rewrite or editorialize. This step is purely mechanical formatting.

### Step 4: Check for existing file

Before writing, check if `Pages/<brand>/<podcast>/episode-reviews/<episode-slug>.md` already exists.

- **If it exists:** STOP and ask the user: "A review for `<slug>` already exists at this path. Overwrite it?"
- **If it doesn't exist:** Proceed.

### Step 5: Write the file to Pages

Write the formatted Jekyll markdown to:

```
Pages/<brand>/<podcast>/episode-reviews/<episode-slug>.md
```

Confirm the file was written successfully by reading it back and verifying the frontmatter and H1 are correct.

### Step 6: Update the series index

Read `Pages/<brand>/<podcast>/episode-reviews/index.md`.

Build the index entry based on `seasonBookMode` from `broadbanner.config.json.shows[<pod-id>]`:

**Season-based:**

```markdown
- [E{episode} \- {label}](./{slug}.md)
```

Under the appropriate `### Season {N}` heading. The episode number and season are parsed from the slug (e.g., `s1e25-forrest-page` → Season 1, E25). The label is the guest name (interview shows) or the short title (news/panel shows).

**Book-based:**

```markdown
- [E{episode} \- {date}](./{slug}.md)
```

Under the appropriate `#### Book {N}` heading. The book number and episode are parsed from the slug (e.g., `book3-e05-2026-01-23` → Book 3, E5).

**Episodic (no season/book grouping):**

```markdown
- [{Episode Title}](./{slug}.md) — {YYYY-MM-DD}
```

Under the single `## Episode Review Articles` heading (no per-season/per-book sub-section). The `{Episode Title}` is the H1 with the leading `{Series Name} | ` prefix stripped — e.g. an H1 of `Powerful Voices | Courage Candidate Joseph Perez-Caputo for CT04` produces a label of `Courage Candidate Joseph Perez-Caputo for CT04`. The trailing date is the episode's publish date in `YYYY-MM-DD`. Use the em-dash character (`—`, U+2014) verbatim — not an escaped `\-` and not a regular hyphen — between the link and the date. No `E{N}` prefix on episodic entries; the slug itself is the identifier.

**Index update rules:**

- If the entry href already exists in the index → skip, report "already indexed"
- If the section heading exists → append after the last list item in that section
- If the section heading doesn't exist → create the section before the trailing `---`
- For episodic shows, append to the existing list under `## Episode Review Articles` — do not create per-season/per-book sub-headings, and do not reorder existing entries

If `index.md` doesn't exist, report a warning but don't fail — the review file itself is still valid.

### Step 7: Branch, commit, and open the PR

The default flow ALWAYS creates a branch and opens a PR — this replaces the legacy `broadbanner episode-pr` CLI command. Only fall back to a direct commit if the user passed `Skip PR = true`.

#### Default path (PR creation)

Run, in order, against the Pages repo (`<pages-root>`):

1. **Verify clean working tree on the base branch.** If `git status --porcelain` shows uncommitted changes unrelated to this publish (i.e. anything outside the two files we just wrote), STOP and report — do not stash silently. The user should resolve the unrelated changes first so they don't get pulled into the episode PR.

2. **Determine the base branch.** Use `main` unless the user has specified otherwise. Confirm `origin/<base>` exists with `git ls-remote --exit-code origin <base>`; if it doesn't, fall back to whatever the current branch is and warn.

3. **Create the feature branch:**

   ```bash
   git -C <pages-root> checkout <base>
   git -C <pages-root> pull --ff-only origin <base>
   git -C <pages-root> checkout -b episode-pipeline/<pod-id>-<slug>
   ```

   If the branch already exists locally, append a short timestamp suffix (e.g. `episode-pipeline/<pod-id>-<slug>-20260505-1430`).

4. **Stage and commit:**

   ```bash
   git -C <pages-root> add <brand>/<podcast>/episode-reviews/<slug>.md
   git -C <pages-root> add <brand>/<podcast>/episode-reviews/index.md   # if updated
   git -C <pages-root> commit -m "feat(episode-reviews): add <slug>" \
       -m "Generated by pages-publish skill for pod-id <pod-id>."
   ```

5. **Push the branch:**

   ```bash
   git -C <pages-root> push -u origin episode-pipeline/<pod-id>-<slug>
   ```

6. **Open the PR via `gh`:**

   ```bash
   gh pr create \
     --base <base> \
     --head episode-pipeline/<pod-id>-<slug> \
     --title "Add episode review: <H1 text>" \
     --body-file <tmp-body-file> \
     [--draft]    # only if PR draft = true
   ```

   PR body should include:
   - Pod-id, slug, and (if applicable) guest name
   - List of changed files (the review markdown + index.md if touched)
   - A line noting "Created automatically by the `pages-publish` skill."

   Capture the printed PR URL — it goes into the final report in Step 9.

7. **Switch back to the base branch** so the working tree is in a clean state for the next operation:

   ```bash
   git -C <pages-root> checkout <base>
   ```

#### Escape hatch (`Skip PR = true`)

Stage and commit directly to the current branch:

```bash
git -C <pages-root> add <brand>/<podcast>/episode-reviews/<slug>.md
git -C <pages-root> add <brand>/<podcast>/episode-reviews/index.md   # if updated
git -C <pages-root> commit -m "feat(episode-reviews): add <slug>" \
    -m "Generated by pages-publish skill for pod-id <pod-id>."
```

Report: "Committed to current branch (no PR). Push manually with `git push` when ready, or re-run without `Skip PR` to open a PR."

### Step 8: Save social distribution copy

The review's social distribution copy (Substack blurb, Bluesky post, YouTube description) is not written to Pages. Save it separately:

```
/tmp/episode-pipeline/<pod-id>_social-copy_<episode-slug>.md
```

This file is for the user to copy-paste when distributing the episode. Report its location.

### Step 9: Report to the user

Present:

- Link to the published file in Pages
- Whether the index was updated (and what entry was added)
- **PR URL** (default path) — or commit hash if the user passed `Skip PR`
- Link to the social distribution copy file
- Summary: "Episode review published. Once the PR is merged, the site will update on the next GitHub Pages deploy."

## Error handling

- **Review file not found:** Ask the user for the correct path. Suggest running `episode-review` first.
- **Pages repo not found:** Check that the Pages directory exists at the expected location. Report the expected path.
- **Review validation fails:** Report exactly which fields are missing. Don't partially publish.
- **File already exists:** Ask before overwriting. Never silently replace.
- **Index.md not found:** Warn but continue — the review file is still valid without the index entry.
- **Git operations fail:** Report the error. The files are already written — the user can manually commit. If the failure was during push or `gh pr create`, the local commit is on the feature branch; tell the user the branch name so they can recover.
- **Working tree dirty on base branch:** STOP. Report the unrelated changes and ask the user to commit, stash, or discard them before re-running. Never silently stash — the episode-pipeline PR must contain only the two files this skill produced.
- **`gh` CLI not available or unauthenticated:** Complete the branch + commit + push, then report: "Branch `<name>` pushed. `gh` is not available — open the PR manually at <github-compare-url>." Do NOT fall back to a no-PR commit on the base branch silently — the user explicitly opted into PR creation by not setting `Skip PR`.
- **Unknown slug format:** If `seasonBookMode` is `season` or `book` and the slug can't be parsed for season/episode/book numbers, ask the user for the index entry details. For `episodic` mode there is nothing to parse — the slug is the identifier and the title comes from the H1.

## Extending the system

**New show:** Onboard via `banner-admin brand-watch --init <podcast-name>` (writes a YAML payload template to CWD); `banner-admin brand-watch` writes the result to `<workspace-root>/broadbanner.config.json` under `shows[<pod-id>]`. Make sure the pod-id is also present in `<workspace-root>/pod-map.json` so the Pages directory resolves. If the show uses a new review section header, document it in `references/pages-format.md`. No changes to this SKILL.md required.

**New Pages layout:** Create the layout in `Pages/_layouts/` and the header/footer includes. The content format doesn't change — layouts are resolved by directory path in `_config.yml`.

## Efficiency notes

The old `pages-writer.ts` (604 lines of TypeScript) handled parsing, formatting, index updating, branching, committing, and PR creation in a single monolithic function. It was tightly coupled to the `episode-pipeline` CLI and only supported the IM narrative format (it hardcoded `### Masculinity In Review` as the body section header).

This skill:

- **Works with any review format** — reads the review as-is and reformats it for Jekyll, regardless of whether it's narrative, book-review, or summary
- **Uses metadata tags** — the review section header, host signature, and index format are all derived from show metadata, not hardcoded
- **Separates concerns** — formatting logic is in the references, not in the skill instructions. Adding a new format's Pages output pattern means updating `references/pages-format.md`, not rewriting the skill.
- **Preserves social copy separately** — the old pipeline discarded social distribution copy during Pages formatting. This skill saves it as a separate deliverable.
