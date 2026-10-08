# Voice Settings — Field Map

Reference for the **Voice tuning** mode of `article-write`. `get_voice` / `set_voice`
read and write one `voice_profiles` row per brand or series. The MCP tool schema is
authoritative for exact key names; this file maps plain-language requests onto fields.

## Scope

- `scope: "brand"` + `id` = the brand id — applies to every series under the brand.
- `scope: "series"` + `id` = the series id (or its short series slug) — that series only.
- **Effective voice = series over brand, field by field.** Scalars and text: series value,
  else brand value. `doRules` / `dontRules`: union, series first, de-duplicated.
  `preferredTerms`: merged by `use`, series wins. `summary` / `guideMd`: both are shown to
  the writer, brand first, series second. `pinnedArticleIds`: series pins, then brand pins.

## Fields

| Field              | Type / limits                                   | Typical request |
| ------------------ | ----------------------------------------------- | --------------- |
| `summary`          | text ≤ 1000                                     | "This series is…", "we sound like…" |
| `audience`         | text ≤ 500                                      | "we write for first-time voters" |
| `tone`             | up to 8 adjectives                              | "more combative", "warmer", "less snarky" |
| `perspective`      | `first-singular` · `first-plural` · `second` · `third` | "write as 'we'", "no 'I'" |
| `formality`        | `casual` · `conversational` · `professional` · `academic` | "less stiff", "more formal" |
| `stance`           | `neutral` · `analytical` · `advocacy` · `polemic` | "take a side", "stay even-handed" |
| `humor`            | `none` · `dry` · `playful` · `satirical`        | "drier", "no jokes" |
| `profanity`        | `none` · `mild` · `unfiltered`                  | "swearing is fine", "keep it clean" |
| `doRules`          | up to 25 rules, each ≤ 200 chars                | "always end with a call to action" |
| `dontRules`        | up to 25 rules, each ≤ 200 chars                | "never say 'folks'", "no rhetorical questions" |
| `preferredTerms`   | up to 50 `{ use, insteadOf? }`                  | "say 'unhoused', not 'homeless'" |
| `signoff`          | text ≤ 300                                      | "end every piece with…" |
| `pinnedArticleIds` | up to 5 **published** article ids in scope      | "write like this piece" (find ids with `list_articles`) |
| `guideMd`          | markdown ≤ 8000                                 | a pasted or long-form style guide |

## Mapping rules

- Prefer the most specific field: a banned word is a `preferredTerms` entry when there is
  a replacement, otherwise a `dontRules` entry.
- "More X" on a scalar dimension moves one step along its scale; on tone, add or replace
  an adjective. Show the before → after.
- Lists are replaced wholesale on write — send the existing items plus the change.
- `null` clears a field (e.g. "stop forcing a sign-off" → `signoff: null`).
- Pinned articles must already be published in the scope; the server rejects others.
- Brand edits need the brand owner; series edits need a host of the series; admins may
  edit either. `get_voice` returns `canEdit` — check it before proposing a change.
