#!/usr/bin/env npx tsx
/**
 * apply-corrections.ts
 *
 * Deterministic pre-processing pass for transcript correction.
 * Applies known corrections from the corrections dictionary before
 * any AI processing happens. This handles the predictable stuff
 * (name misspellings, brand name errors) so the AI can focus on
 * the harder problems (speaker attribution, readability, structure).
 *
 * Usage:
 *   npx tsx apply-corrections.ts <transcript_path> [options]
 *
 * Arguments:
 *   transcript_path         Path to the raw transcript .txt file
 *
 * Options:
 *   --dictionary <path>     Path to corrections-dictionary.json
 *                           [default: ../references/corrections-dictionary.json]
 *   --dry-run               Print what would change without modifying the file
 *   --report                Print a summary of all corrections made
 *   --out <path>            Write corrected output to this path instead of
 *                           modifying in place. Use "-" for stdout.
 *
 * The script:
 *   1. Loads the corrections dictionary
 *   2. Builds a case-aware lookup from all misspelling variants
 *   3. Applies longest-match-first replacement (avoids partial matches)
 *   4. Reports what was changed and how many times
 *
 * Exit codes:
 *   0   Success (corrections applied or none needed)
 *   1   Error (file not found, invalid JSON, etc.)
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CorrectionsDictionary {
  _meta?: Record<string, unknown>;
  [category: string]: Record<string, string[]> | Record<string, unknown> | undefined;
}

interface ReplacementRule {
  pattern: RegExp;
  correct: string;
  /** The raw misspelling string, kept for reporting */
  wrong: string;
}

interface CorrectionChange {
  from: string;
  to: string;
  count: number;
}

interface CorrectionResult {
  text: string;
  changes: CorrectionChange[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dictionary loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and flatten the corrections dictionary into { correct: wrong[] } pairs.
 * Skips the `_meta` key and any entry key starting with `_`.
 */
function loadDictionary(dictPath: string): Map<string, string[]> {
  const raw = JSON.parse(fs.readFileSync(dictPath, "utf8")) as CorrectionsDictionary;
  const flat = new Map<string, string[]>();

  for (const [category, entries] of Object.entries(raw)) {
    if (category === "_meta" || typeof entries !== "object" || entries === null) continue;

    for (const [correct, misspellings] of Object.entries(entries as Record<string, unknown>)) {
      if (correct.startsWith("_")) continue;
      if (!Array.isArray(misspellings)) continue;

      const existing = flat.get(correct) ?? [];
      existing.push(...(misspellings as string[]));
      flat.set(correct, existing);
    }
  }

  return flat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regex helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Escape special regex characters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a sorted list of replacement rules from the dictionary.
 *
 * Sorted longest-misspelling-first so "Sick of the Ship Publications"
 * matches before "sub stack" can partially interfere.
 *
 * Case-insensitive matching is used ONLY for all-lowercase misspellings.
 * This catches "nick para" whether it appears as "Nick Para" or "nick para",
 * but prevents mixed-case entries from over-matching.
 */
function buildReplacements(dictionary: Map<string, string[]>): ReplacementRule[] {
  const pairs: { wrong: string; correct: string }[] = [];

  for (const [correct, misspellings] of dictionary) {
    for (const wrong of misspellings) {
      // Skip if the misspelling is identical to the correct form (case-insensitive)
      if (wrong.toLowerCase() === correct.toLowerCase()) continue;
      pairs.push({ wrong, correct });
    }
  }

  // Sort longest misspelling first
  pairs.sort((a, b) => b.wrong.length - a.wrong.length);

  return pairs.map(({ wrong, correct }) => {
    const ignoreCase = wrong === wrong.toLowerCase();
    const flags = ignoreCase ? "gi" : "g";
    const pattern = new RegExp(`\\b${escapeRegex(wrong)}\\b`, flags);
    return { pattern, correct, wrong };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core correction logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply all replacement rules to the text.
 * Returns the corrected text and a list of changes for reporting.
 */
function applyCorrections(text: string, rules: ReplacementRule[]): CorrectionResult {
  const changes: CorrectionChange[] = [];

  for (const rule of rules) {
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      changes.push({
        from: matches[0]!,
        to: rule.correct,
        count: matches.length,
      });
      text = text.replace(rule.pattern, rule.correct);
    }
  }

  return { text, changes };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
apply-corrections — deterministic transcript pre-processing

Usage:
  npx tsx apply-corrections.ts <transcript_path> [options]

Options:
  --dictionary <path>   Path to corrections-dictionary.json
                        [default: ../references/corrections-dictionary.json]
  --dry-run             Show what would change without writing
  --report              Print a summary of corrections made
  --out <path>          Write to this path instead of in-place ("-" for stdout)
  --help                Show this help
`.trim());
}

function die(msg: string): never {
  console.error(`[apply-corrections] ERROR: ${msg}`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  // First non-flag argument is the transcript path
  const transcriptPath = args.find((a) => !a.startsWith("--"));
  if (!transcriptPath) die("No transcript path provided.");
  if (!fs.existsSync(transcriptPath)) die(`File not found: ${transcriptPath}`);

  // Parse flags
  const dryRun = args.includes("--dry-run");
  const report = args.includes("--report") || dryRun;

  function getOpt(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  }

  const outPath = getOpt("--out");

  // Default dictionary path: relative to this script
  const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
  const dictPath = getOpt("--dictionary") ??
    path.resolve(scriptDir, "..", "references", "corrections-dictionary.json");

  if (!fs.existsSync(dictPath)) die(`Dictionary not found: ${dictPath}`);

  // Load and apply
  const dictionary = loadDictionary(dictPath);
  const rules = buildReplacements(dictionary);
  const original = fs.readFileSync(transcriptPath, "utf8");
  const { text: corrected, changes } = applyCorrections(original, rules);

  // Report
  if (report) {
    if (changes.length > 0) {
      const total = changes.reduce((sum, c) => sum + c.count, 0);
      console.log(`\n--- Corrections Report (${total} replacements) ---`);
      for (const c of changes) {
        console.log(`  "${c.from}" -> "${c.to}" (${c.count}x)`);
      }
      console.log("---\n");
    } else {
      console.log("\n--- No known corrections needed ---\n");
    }
  }

  // Output
  if (dryRun) {
    console.log("(dry-run: no files modified)");
    return;
  }

  if (outPath === "-") {
    process.stdout.write(corrected);
  } else if (outPath) {
    fs.writeFileSync(outPath, corrected, "utf8");
    console.log(`Corrected transcript written to: ${outPath}`);
  } else {
    fs.writeFileSync(transcriptPath, corrected, "utf8");
    console.log(`Corrected transcript written to: ${transcriptPath} (in-place)`);
  }
}

main();
