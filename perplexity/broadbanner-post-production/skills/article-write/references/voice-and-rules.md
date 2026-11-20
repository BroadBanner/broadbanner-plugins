# Article Write — Voice tuning and learned rules

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Voice tuning

When the user says things like "make Palantalk sound more combative" or "remember our
brand never says 'folks'":

1. Decide the **scope** and tell the user which you're editing:
   - **Brand** voice applies to every series under the brand.
   - **Series** voice applies to that series only and **overrides the brand** field by
     field (do/don't rules and preferred terms are combined, series first).
   If it's unclear which they mean, ask.
2. `get_voice({ scope: "brand" | "series", id })` to read the current settings
   and `canEdit`. If `canEdit` is false, explain that only the series host / brand owner
   (or an admin) can change it, and stop.
3. Map the request onto fields (see `references/voice-fields.md`) and show the proposed
   change as before → after.
4. On confirmation, `set_voice({ scope, id, ...changedFields })` — merge
   semantics: send only changed keys; `null` clears a field. For list fields
   (`doRules`, `dontRules`, `preferredTerms`, `tone`), send the full new list (existing
   items + the addition).
5. Confirm what changed and that it applies to future drafts for that scope.

## Learned rules

When the user asks what the system has learned, or wants to correct it:

- `article_style_rules({ action: "list" })` — show rules grouped by status (candidate /
  confirmed), each with its evidence count.
- `article_style_rules({ action: "confirm", ruleId })` — the creator agrees; it becomes a
  firm instruction.
- `article_style_rules({ action: "dismiss", ruleId })` — wrong or unwanted; it stops
  applying.
- `reset` only on an explicit request, after confirming it wipes the learned memory.

These rules are **personal** — they follow the creator across all brands and series.
Brand/series voice is set separately (Voice tuning).
