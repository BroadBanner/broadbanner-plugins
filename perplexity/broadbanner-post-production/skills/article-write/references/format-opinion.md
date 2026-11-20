# Opinion Piece Format

Used for `form: "opinion"` — op-eds, arguments, hot takes with a spine. The piece makes
**one claim** and defends it. Voice (tone, perspective, banned terms, sign-off) comes from
`get_writing_context`; this file governs structure.

## Structure

The output is markdown with `title` and `subtitle` held separately (no H1 in the body).

### 1. Title + Subtitle

- **Title:** states the position or the stakes, 4-12 words. A verb helps. No clickbait,
  no "Why X Matters", no question titles unless the answer is the argument.
- **Subtitle:** 1 sentence, ≤ 200 characters — the thesis in plain words.

### 2. Opening (1 paragraph, 3-5 sentences)

Start with something concrete: a scene, a fact, a quote from the archive, or the news
hook. Land the **thesis by the end of the first paragraph** — the reader should know
what you're arguing and why now.

### 3. Argument (3-5 paragraphs, 3-6 sentences each)

- Each paragraph advances **one** supporting point, in order of strength (strongest
  last or first — never buried in the middle).
- Every point carries evidence: a sourced fact, an example, a past episode or article,
  or a direct quote. Opinion without evidence is filler.
- Optional H3 subheads only for pieces over ~900 words.

### 4. Counterargument (1 paragraph)

State the strongest opposing view **fairly**, in terms its holders would accept, then
answer it. Skip only if the voice's `stance` is `polemic` and the user asked for it.

### 5. Close (1 paragraph, 2-4 sentences)

Return to the opening image or hook, and end on what the reader should **think, watch
for, or do**. A specific call to action beats an exhortation. Add the scope's
`signoff` if set.

## Length

600-1,000 words by default; follow `articleConfig.articleLength` when set (short ≈
500-700, long ≈ 1,000-1,400).

## Avoid

- Hedging the thesis into mush ("it's complicated", "time will tell")
- Strawmen; attacking motives instead of arguments
- Stacked rhetorical questions; "Make no mistake"; "Let that sink in"
- The "it's not X, it's Y" construction more than once
- Unsourced statistics or current-events claims stated as fact — flag them instead
- Reusing facts or quotes from exemplars
