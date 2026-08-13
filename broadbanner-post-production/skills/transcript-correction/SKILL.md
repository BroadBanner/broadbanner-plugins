---
name: transcript-correction
description: "Correct and clean a raw Substack transcript against the LIVE roster of who was in the room — fix names, attribute speakers, remove filler, structure for readability. Use when the user wants to correct/clean a transcript, or after transcript-download in the post-production chain. Pulls the primary-host/host/guest names from the connector's get_show_roster and merges them into BOTH the deterministic name pass AND the AI speaker-attribution pass, so real names win over the static dictionary. Self-learning dictionary preserved. Production+ add-on (post_production_distribution)."
metadata:
  requiresTool: post_production_distribution
---

# Transcript Correction

Clean a raw auto-generated transcript into a readable, properly attributed document ready
for review generation — corrected against the **live roster** of who was actually in the
room for this show, fetched from the BroadBanner MCP connector.

## Why this skill exists

Auto-transcription consistently mangles the same things: host names, publication names,
speaker labels, and domain terms. Most fixes are deterministic, so we split the work:

1. **Deterministic pass** — a TypeScript script applies known corrections from a
   dictionary (zero API cost, instant).
2. **AI pass** — Claude handles what needs judgment (speaker attribution, readability,
   structure).

**What's new vs. the legacy episode-pipeline correction:** the primary-host, co-host, and
guest names for THIS show are no longer guessed from a static config or dictionary — they
come **live** from `get_show_roster`. Those real names are merged into both passes, so a
guest who has never appeared before is still spelled and attributed correctly. The
self-learning dictionary append is preserved for genuinely new recurring misspellings.

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: post_production_distribution`. Call
`get_creator_context`; if it returns a capability summary
(`entitledTools` / `caps` / `isAdmin`), confirm the add-on is present (or `isAdmin`).
If present-and-absent, stop with the CTA below; if the fields are omitted (older
connector), proceed — the connector gate is the backstop. When invoked by the
`post-production` orchestrator, this has already run — don't repeat it.

> ⚠️ Post-production is the **Production+** add-on (`post_production_distribution`, $5/mo).
> Your account isn't entitled yet — add it from https://app.broadbanner.com/pricing/membership.

## Inputs

| Input             | Required | Example                                             | Notes                                                            |
| ----------------- | -------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `transcriptPath`  | Yes      | `/tmp/post-production/babm-palan_e12-….txt`         | The raw `.txt` from transcript-download                          |
| Resolved series   | Yes      | `{ seriesId, showId, seriesTitle }`                 | From the orchestrator's Step 0 (or pass `seriesName` to resolve) |
| Roster (optional) | No       | `{ primaryHost, hosts[], guests[] }`                | If the orchestrator already fetched it, reuse it — else Phase 0 fetches |
| `episodeTitle`    | Rec.     | `Palantalk | E12 - Surveillance Capitalism and You` | For the corrected-transcript header                              |
| `episodeDate`     | Rec.     | `2026-03-31`                                        | For the header                                                   |

If the user just ran transcript-download, carry these forward — nothing needs re-asking.

## Step-by-step workflow

### Phase 0: Fetch the live roster (the key change)

Call `get_show_roster` for the resolved show — **prefer `showId`** if you have it,
otherwise `seriesId`:

```
get_show_roster({ showId })      // or { seriesId }
```

From `roster` extract, as `{ id, name, displayName }` objects:

- `primaryHost` — the primary host of this show
- `hosts[]` — all hosts (includes co-hosts / the primary)
- `guests[]` — the guest(s) for THIS show instance

Build a **roster name set** = the `name` (and `displayName`, if different) of every person
in `primaryHost` + `hosts` + `guests`. These are the ground-truth spellings for this
episode. If `get_show_roster` returns an authorization error, stop — the session isn't
entitled (there's no local fallback roster). If it returns an empty roster (no hosts/guests
recorded), fall back to dictionary-only correction and flag it in the report.

### Phase 1: Deterministic corrections (script) — roster-merged

This phase is instant and costs nothing. Run it first, always.

1. **Build an ephemeral roster overlay dictionary.** For each roster person, generate the
   common auto-transcription misspelling variants of their `name` and map them to the
   correct `name`. At minimum, cover: dropped/added trailing vowels, common homophones of
   the surname, and a lowercased variant (the script matches all-lowercase entries
   case-insensitively). Write this overlay as a JSON file in the same schema as
   `references/corrections-dictionary.json` (a `people` category is enough), e.g.
   `/tmp/post-production/roster-overlay.json`:

   ```json
   {
     "people": {
       "Forrest Page": ["Forest Page", "Forrest Paige", "forrest page"],
       "Ada Chen": ["Ada Chan", "Aida Chen", "ada chen"]
     }
   }
   ```

   The roster spellings take precedence — if a roster name conflicts with a stale
   dictionary entry, the roster wins.

2. **Run the corrections script twice** (base dictionary, then the roster overlay), or
   merge both dictionaries first and run once. Using `--out` keeps the raw file intact:

   ```bash
   # base dictionary
   npx tsx skills/transcript-correction/scripts/apply-corrections.ts \
     "<transcriptPath>" \
     --dictionary skills/transcript-correction/references/corrections-dictionary.json \
     --out "<transcriptPath>.corrected" --report

   # roster overlay (feed the just-written .corrected back in)
   npx tsx skills/transcript-correction/scripts/apply-corrections.ts \
     "<transcriptPath>.corrected" \
     --dictionary /tmp/post-production/roster-overlay.json \
     --out "<transcriptPath>.corrected" --report
   ```

   (Run `bash boolgic.sh enable` / install deps first if `npx tsx` isn't available.)

3. **Show the merged report** (base + roster substitutions, with counts) to the user so
   they can confirm the corrections — especially the roster-name normalizations — look
   right.

### Phase 2: AI correction (Claude) — roster-anchored attribution

This phase handles what a script cannot: speaker attribution, filler removal, paragraph
structure, and readability. **The roster is the anchor for attribution.**

1. **Use the Phase 0 roster as the authoritative speaker list.** The `primaryHost` and
   `hosts[]` are the recurring voices; `guests[]` are this episode's guests. Do NOT invent
   speakers outside the roster unless the transcript unambiguously introduces someone the
   roster omits (in which case attribute by first name and flag it).

2. **Read the pre-corrected transcript** (the `.corrected` output from Phase 1).

3. **Apply corrections** directly (you ARE the correction engine — do not call an external
   API). Follow the rules below.

#### Correction prompt

**Speaker attribution** (the hardest part, now roster-anchored):

- Replace generic labels (`[SPEAKER_00]`, timestamp-only blocks) with actual **first
  names from the roster**.
- The primary host usually opens and drives the conversation — that's your anchor. Work
  outward: the guest(s) are the non-host voices; co-hosts are the other roster hosts.
- Format: `**[FirstName]:** dialogue text`
- If a speaker genuinely cannot be matched to a roster person, use `**[Speaker N]:**` and
  flag it — never assign a roster name you're not confident about.

**Readability:**

- Fix punctuation and capitalization.
- Break long run-on passages into 2-5 sentence paragraphs.
- Remove filler (`um`, `uh`, filler `like`) only where it adds nothing; preserve filler
  that carries conversational weight.
- Do not rewrite anyone's voice or style.

**Structure** — prepend this header (populated from the roster + episode inputs):

```
Series: [seriesTitle] ([seriesId])
Primary host: [primaryHost.name]
Hosts: [comma-joined hosts[].name]
Guest(s): [comma-joined guests[].name, or "none"]
Episode: [episodeTitle]
Date: [episodeDate]
```

- Keep speaker turns as distinct blocks.
- `[unclear]` for genuinely unintelligible audio — never fabricate.
- `[overlapping]` / `[laughter]` / `[crosstalk]` sparingly, only where it matters.

**What NOT to do:** don't change the substance of what anyone said; don't add
commentary; don't fix natural-speech grammar; don't remove profanity (intentional in
these shows); don't over-polish.

4. **Save the corrected transcript** in place (overwrite the raw `.txt` at
   `transcriptPath`). The intermediate `.corrected` file can be deleted.

### Phase 3: Dictionary update (self-learning)

After the AI pass, add genuinely new recurring misspellings to the **base** dictionary
(not the ephemeral roster overlay — that's disposable):

1. Scan the corrections you made for new name/org/term misspellings not already in
   `references/corrections-dictionary.json`. A one-off guest is usually NOT worth
   persisting — only add spellings likely to recur (recurring hosts, brands, domain
   terms).
2. If found, read `skills/transcript-correction/references/corrections-dictionary.json`,
   add the variants under the right category + correct form, bump `_meta.last_updated`,
   and write it back.
3. Report any additions.

## Output

The corrected transcript, saved in-place at `transcriptPath`:

- Readable as a standalone document
- Attributed to speakers by first name, anchored to the live roster
- Structured with the roster-populated metadata header
- Free of known transcription artifacts
- Ready as input for the episode-review skill

Report:

- The corrected `transcriptPath`
- Roster used (primary host, hosts, guests) and how many speaker labels were resolved
- A summary of what changed (roster normalizations, filler removals, flagged unclear
  sections)
- Any new base-dictionary entries added
- Next: "Transcript corrected. Next: episode-review (using the show's editorial config)."

**Carries forward:** corrected `transcriptPath`, confirmed roster/speaker names, flagged
sections.

## Error handling

- **`get_show_roster` authorization error:** stop — the session isn't entitled to
  `post_production_distribution`. No local roster fallback.
- **Empty roster:** correct with the base dictionary only and flag prominently that
  attribution wasn't roster-anchored — the operator should verify speaker names.
- **Guest ambiguity:** if the transcript suggests a guest not in `guests[]`, attribute by
  first name and flag it — don't silently invent a roster entry.
- **Transcript too short or empty:** report and stop — the download may have failed.
- **Dictionary file missing:** the script errors clearly. The base dictionary lives at
  `references/corrections-dictionary.json` relative to this skill.

## Efficiency notes

The deterministic script pre-corrects predictable errors (base dictionary + this
episode's roster overlay) so the AI pass only spends tokens on judgment work — speaker
attribution and readability. Merging the live roster into the deterministic pass means the
AI rarely has to fix a mangled name at all; it can focus on attributing turns to the right
person. The base dictionary keeps growing (recurring names/terms only), so every run makes
the deterministic pass more effective over time.
