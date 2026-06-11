# Pages Output Format

This reference defines the exact file format the Pages repo expects for episode reviews. The Pages repo is a Jekyll site — layouts are applied automatically based on directory path, so the content files only need empty frontmatter and properly structured markdown.

## Jekyll Frontmatter

Every episode review file uses empty frontmatter. No metadata fields. This is required for Jekyll to process the file.

```
---
---
```

The layout is resolved by `_config.yml` defaults based on the file's directory path (e.g., files in `sick-of-this-shit-publications/intelligent-masculinity/` automatically get the `intelligent-masculinity` layout).

## File Structure by Review Format

### Narrative format (IM, CIO, DC)

```markdown
---
---

# {Series Name} | {Title Suffix}

## {Subtitle or Pages H2}

> "{Block quote text}"
>
> _\~ {Speaker Name} \~_

### {Review Section Header}

{Body paragraphs — continuous narrative, no sub-headers within the body}

\~ [{Host Name}]({host-url})

---
```

**Title suffix patterns:**
- IM: `With {Guest Name}` (no episode number in H1)
- CIO/DC: `E{N} - {Short Title}`

**Review section headers:**
- IM: `Masculinity In Review`
- CIO: `Chronic Illness In Review`
- DC: `Diogenes In Review`

### Book-review format (AFBC)

```markdown
---
---

# {Series Name} | {Book Name} - {Short Title}

## {Subtitle}

> "{Block quote text}"
>
> _\~ {Speaker Name} \~_

### Book In Review

{Body paragraphs — 3-5 paragraphs of continuous narrative}

### Books Mentioned

- *{Book Title}* by {Author} — [{link text}]({url})

---
```

### Summary format (PALAN, NOTW, FR, EW)

```markdown
---
---

# {Series Name} | E{N} - {Short Title}

## {Subtitle}

##### Watch the full episode on Substack: [{Episode Label}]({substack-url})

### {Review Section Header}

{Summary paragraph — 4-6 sentences}

---

### Key Takeaways

- {Takeaway 1}
- {Takeaway 2}
- {Takeaway 3}

---

### People, Organizations, and Terms

**People:**
- {Name} — {relevance}

**Organizations / Programs:**
- {Org} — {relevance}

**Terms / Concepts:**
- {Term} — {definition}

---

### Sources & References

- [{Source title}]({url})

---

\~ {Host Name(s)}

---
```

**Review section headers for summary shows:**
- PALAN: `PalanReview`
- NOTW: `Notes In Review`
- FR: `Firebrand In Review`
- EW: `Epistemic In Review`
- TFL: `Time For Life In Review`

## Formatting Rules

- **Escaped hyphens in index entries:** Use `\-` in index.md link labels (e.g., `E25 \- Forrest Page`)
- **Host signature:** `\~ [{Name}]({url})` if URL available, otherwise `\~ {Name}` or `\~ {Name1}, {Name2}`
- **Block quotes:** Use `>` prefix with `_\~ {Name} \~_` attribution on a separate `>` line
- **Section separators:** Use `---` between major sections in summary format. Narrative format uses a single `---` at the end only.
- **No HTML:** Pure markdown. The Jekyll layout handles all HTML wrapping.
- **Bold in headers:** Some existing files use `### **Header**` with bold inside H3. Either format is acceptable — the layout renders them the same.
