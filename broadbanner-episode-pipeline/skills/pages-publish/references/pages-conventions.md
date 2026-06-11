# Pages Conventions

Filename, index, and update conventions for episode reviews in the Pages repo.

The brand and podcast directory names for any pod-id are derived from `<workspace-root>/pod-map.json` (the workspace root is the directory containing `broadbanner.config.json` — walk up from CWD if needed). This file no longer hardcodes per-pod-id paths; instead it describes the filename and index logic that applies once the directory has been resolved.

The episode-reviews path always resolves to:

```
Pages/<brand>/<podcast>/episode-reviews/
```

where `<brand>` and `<podcast>` come from `pod-map.json[<pod-id>]`.

## Filename Conventions

### Season-based shows

```
s{season}e{episode}-{slug}.md
```

Examples:

- `s1e25-forrest-page.md` (interview show — guest name as slug)
- `s1e29-2026-03-03.md` (panel show — date as slug)
- `s1e27-supremacy-as-policy.md` (news show — topic as slug)

Slug rules: lowercase, hyphens for spaces, no special characters. Guest-name slugs for interview shows, date or topic slugs for panel/news shows.

### Book-based shows

```
book{N}-e{episode}-{date}.md
```

Examples:

- `book3-e05-2026-01-23.md`
- `book4-e01-2026-04-03.md`

### Episodic shows (no season/book grouping)

```
{episode-slug}.md
```

Examples:

- `courage-candidate-joseph-perez-caputo-ct04.md`
- `courage-candidates-keira-havens.md`
- `courage-candidate-brittany-jones-for-governor-of-oregon.md`

Slug rules: the episode title, kebab-cased (lowercase, hyphens for spaces, no special characters). No `s{N}e{N}` or `book{N}-e{N}` prefix — the slug **is** the identifier. Used by shows where each episode stands alone (interview series, candidate spotlights, one-off conversations).

Whether a show is season-based, book-based, or episodic is determined by `broadbanner.config.json.shows[<pod-id>].seasonBookMode` (`season` | `book` | `episodic`).

## Index.md Structure

Every series has an `index.md` at its episode-reviews path root.

### Season-based index entry

```markdown
### Season {N}

- [E{episode} \- {Guest or Title}](./{filename})
```

Section heading: `### Season {N}`
Entry format: `- [E{episode} \- {label}](./{filename})`

### Book-based index entry

```markdown
#### Book {N} - **{Book Title}**, by {Author}

- [E{episode} \- {date}](./{filename})
```

Section heading: `#### Book {N} - **{Book Title}**, by {Author}`
Entry format: `- [E{episode} \- {date}](./{filename})`

### Episodic index entry

```markdown
## Episode Review Articles

- [{Episode Title}](./{filename}) — {YYYY-MM-DD}
```

Section heading: `## Episode Review Articles` — single section, used directly under the H1; no per-season or per-book sub-headings.
Entry format: `- [{Episode Title}](./{filename}) — {YYYY-MM-DD}`

`{Episode Title}` is the H1 of the published review with the leading `{Series Name} | ` prefix stripped. The separator between the link and the date is the em-dash character (`—`, U+2014) verbatim — not an escaped `\-` and not a regular hyphen.

## Index Update Rules

- If the section heading (e.g., `### Season 1`) already exists, append the new entry after the last list item in that section
- If the section doesn't exist, create it before the trailing `---`
- If the entry already exists (matching href), skip — don't duplicate
- For season-based and book-based shows, maintain ascending episode order within each section
- For episodic shows, append to the existing list under `## Episode Review Articles` — do not reorder existing entries and do not introduce sub-headings
