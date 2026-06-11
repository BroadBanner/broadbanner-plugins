---
name: transcript-correction
description: "Correct and clean a raw podcast transcript — fix names, attribute speakers, remove filler, and structure for readability. Use this skill whenever the user mentions correcting a transcript, cleaning a transcript, fixing a transcript, or preparing a raw transcript for review. Also triggers when the user has just downloaded a transcript and wants the next step, or says 'clean this up' about a transcript file. Includes a self-updating corrections dictionary that learns new name misspellings over time."
---

# Transcript Correction

Clean a raw auto-generated transcript into a readable, properly attributed document ready for downstream processing (episode review generation, publishing).

## Why this skill exists

Auto-transcription consistently mangles the same things: host names, publication names, speaker labels, and domain-specific terms. The old approach threw the entire raw transcript at a Claude API call with ~3,000 tokens of system prompt context. That's wasteful because most corrections are deterministic — "Nick Parrow" is always wrong, "Nick Paro" is always right. There's no reason to burn API tokens on predictable fixes.

This skill splits the work into two phases:

1. **Deterministic pass** — a Python script applies known corrections from a dictionary (zero API cost, instant)
2. **AI pass** — Claude handles the things that actually require judgment (speaker attribution, readability, structure)

The result is faster, cheaper, and more consistent.

## Inputs

| Input                | Required    | Example                                                                                                  | Notes                                                     |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Transcript file path | Yes         | `Social-Distribution/transcripts/sick-of-this-shit-publications/intelligent-masculinity/season-01/IM_s1e25_forrest-page.txt` | The raw .txt from Substack                                |
| Pod ID               | Yes         | `sotsp-im`                                                                                               | Used to load series metadata                              |
| Guest name(s)        | Recommended | `Forrest Page`                                                                                           | Helps with speaker attribution. If unknown, ask the user. |
| Episode identifier   | Recommended | `S1E25`                                                                                                  | For the corrected transcript header                       |
| Episode date         | Recommended | `2026-03-31`                                                                                             | For the corrected transcript header                       |

If the user just ran the `transcript-download` skill, most of these inputs are already known — carry them forward.

## Step-by-step workflow

### Phase 1: Deterministic corrections (script)

This phase is instant and costs nothing. Run it first, always.

1. **Run the corrections script** on the raw transcript:

   ```bash
   npx tsx BroadBanner/Skills/transcript-correction/scripts/apply-corrections.ts \
     "<transcript_path>" \
     --out "<transcript_path>.corrected" \
     --report
   ```

2. **Review the report output.** It will list every substitution made and how many times. Example:

   ```
   --- Corrections Report (7 replacements) ---
     "Nick Parrow" -> "Nick Paro" (3x)
     "sick of the ship" -> "Sick of This Shit" (2x)
     "sub stack" -> "Substack" (2x)
   ---
   ```

3. **Show the report to the user** so they can confirm the corrections look right. If any seem wrong, adjust the dictionary before proceeding.

### Phase 2: AI correction (Claude)

This phase handles what a script cannot: speaker attribution, filler removal, paragraph structure, and readability. The goal is a focused, efficient prompt — not a kitchen-sink system prompt.

1. **Load series metadata.** Resolve the workspace root (the directory containing `broadbanner.config.json` — walk up from CWD if needed) and read:

   ```
   <workspace-root>/broadbanner.config.json
   ```

   From `shows[<pod-id>]` extract: `displayName`, `seriesId`, `host`, `commonHosts`, `seasonBookMode`.

2. **Read the pre-corrected transcript** (the `.corrected` output from Phase 1).

3. **Apply corrections using the prompt structure below.** Read the transcript and produce the corrected output directly — do not call the Anthropic API externally. The skill executor (Claude) IS the correction engine.

#### Correction prompt

When correcting the transcript, follow these rules in priority order:

**Speaker attribution** (the hardest part):

- Replace generic labels (`[SPEAKER_00]`, `[SPEAKER_02]`, timestamp-only blocks) with actual first names
- Use the guest name(s) provided by the user and the host name(s) from series metadata
- Format: `**[FirstName]:** dialogue text`
- If a speaker cannot be identified with confidence, use `**[Speaker N]:**` and flag it
- When the host introduces themselves or the guest, that's your anchor — work outward from there

**Readability**:

- Fix punctuation and capitalization
- Break long run-on passages into paragraphs of 2-5 sentences
- Remove filler words (`um`, `uh`, `like` as filler) only where they add no meaning
- Preserve filler that carries conversational weight (hesitation that matters, emphasis)
- Do not rewrite voice or style — the speaker should still sound like themselves

**Structure**:

- Prepend this header to the corrected output:
  ```
  Series: [Series Name] ([Series ID])
  Hosts: [Common Hosts]
  Mode: [season | book | episodic]
  Episode/Session: [episode identifier — S{N}E{N}, Book {N} E{N}, or the episode-title slug for episodic shows]
  Date: [date]
  Guest: [guest name(s)]
  ```
- Keep speaker turns as distinct blocks
- Use `[unclear]` for genuinely unintelligible audio — never fabricate
- Use `[overlapping]`, `[laughter]`, `[crosstalk]` sparingly where it matters for meaning

**What NOT to do**:

- Do not change the substance of what anyone said
- Do not add commentary or analysis
- Do not fix grammar that's part of someone's natural speech pattern
- Do not remove profanity (it's intentional in these shows)
- Do not over-polish — these are conversations, not essays

4. **Save the corrected transcript** to the same directory as the original, with the same filename. The pre-corrected intermediate file (`.corrected`) can be deleted.

### Phase 3: Dictionary update (self-learning)

After each correction run, check whether any new corrections were discovered during the AI pass that should be added to the dictionary for future runs.

1. **Scan the corrections you made** during Phase 2. Look for:
   - New name misspellings you fixed that aren't in the dictionary yet
   - New organization/brand misspellings
   - New recurring terms that auto-transcription consistently gets wrong

2. **If new corrections are found**, update the dictionary:
   - Read `BroadBanner/Skills/transcript-correction/references/corrections-dictionary.json`
   - Add the new misspelling variants under the appropriate category and correct form
   - Update the `_meta.last_updated` date
   - Write the file back

3. **Report any additions to the user.** Example: "I added 'Nick Pero' as a known misspelling of 'Nick Paro' to the corrections dictionary — it'll be caught automatically next time."

This is how the dictionary stays current without manual maintenance. Each transcript processed makes future transcripts cheaper to correct.

## Output

The corrected transcript file, saved in-place (overwriting the raw version at the original path). The file should be:

- Readable as a standalone document
- Properly attributed to speakers by first name
- Structured with a metadata header
- Free of known transcription artifacts
- Ready as input for the episode-review skill

Report to the user:

- The file path of the corrected transcript
- A summary of what changed (speaker attributions, number of filler removals, any flagged unclear sections)
- Any new entries added to the corrections dictionary
- Suggested next step: "The transcript is corrected. You can now run episode review generation on it."

## Error handling

- **Guest name unknown**: Ask the user. Don't guess based on transcript content alone — you might attribute dialogue to the wrong person.
- **Multiple guests**: Handle each as a separate speaker. Ask the user to confirm the guest list.
- **Transcript too short or empty**: Report the issue and stop. The download may have failed.
- **Dictionary file missing**: The script will error with a clear message. The dictionary lives at `references/corrections-dictionary.json` relative to this skill.

## Efficiency notes

The old pipeline (`ai-steps.ts correctTranscript`) loaded ~3,000 tokens of system prompt (SYSTEM_PROMPT.md + OUTPUT_STANDARDS.md + 20_CORRECT_TRANSCRIPT.md) and sent the full raw transcript to claude-sonnet with 8,192 max output tokens. For a 40-minute podcast transcript (~15,000 words), that's roughly 25,000 input tokens and up to 8,192 output tokens per run.

This skill reduces AI token usage by:

- **Pre-correcting known issues** deterministically via the TypeScript script (saves the AI from fixing the same "Nick Parrow" → "Nick Paro" every single time — zero API cost, instant)
- **Focused prompt** — the correction rules above are ~400 words instead of 3,000
- **No redundant context** — series metadata is loaded on demand for the header, not packed into a system prompt
- **Growing dictionary** — every run makes the deterministic pass more effective, so the AI has less to do over time

The deterministic script is TypeScript (`scripts/apply-corrections.ts`) to stay consistent with the BroadBanner ecosystem convention. Run with `npx tsx` from the Skills directory after running `bash boolgic.sh enable` to install dependencies.
