# Column Format

Used for `form: "column"` — a recurring, personality-driven piece for a series or brand
(a weekly column, a regular dispatch). Readers come back for the **columnist's voice and
the recurring shape** as much as for the topic. Voice comes from `get_writing_context`;
this file governs structure.

## Recurring shape first

Before drafting, read the exemplars from `get_writing_context` that are columns in the
same series (`form: "column"`, `own: true`). If the column has an established shape — a
standing intro line, named recurring segments, a numbered list, a sign-off — **reproduce
that shape exactly**. The structure below is the default only when there's no precedent.

## Default structure

Markdown with `title` and `subtitle` held separately (no H1 in the body).

### 1. Title + Subtitle

- **Title:** follow the column's naming pattern if exemplars show one (e.g. a column
  name plus a topic). Otherwise 3-9 words, conversational.
- **Subtitle:** 1 sentence, ≤ 200 characters, in the columnist's voice.

### 2. Lede (1 paragraph, 2-4 sentences)

Direct address. What's on the columnist's mind this time and why — a personal
observation, something from the latest show, a reader question.

### 3. Main item (3-5 paragraphs)

The column's core topic, developed with a clear point of view. First person is
expected unless the voice's `perspective` says otherwise. Tie it to the series: past
episodes, recurring themes, running jokes the audience knows (only ones found in the
archive).

### 4. Shorter items (optional, 2-4 items)

Brief segments under H3 subheads or bold lead-ins, 1-2 paragraphs each: quick takes,
follow-ups on earlier columns, recommendations, things to watch.

### 5. Sign-off (1 short paragraph)

What's coming next (next show, next column), a call to action, and the scope's
`signoff` if set. Columns end the same way every time — consistency is the point.

## Length

700-1,200 words by default; follow `articleConfig.articleLength` when set (short ≈
500-700, long ≈ 1,200-1,600).

## Avoid

- Breaking an established column shape or renaming recurring segments
- Generic, could-be-anyone prose — the columnist's personality is the product
- Inside jokes or callbacks you didn't find in the archive
- Unsourced current-events claims stated as fact — flag them
- Reusing facts or quotes from exemplars
