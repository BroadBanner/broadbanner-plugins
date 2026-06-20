#!/usr/bin/env node
/**
 * collect-tasks.mjs
 *
 * Deterministic enumerator for the `install-scheduled-tasks` skill.
 *
 * It does the parts that should NOT be left to a language model: find the
 * project root, derive per-project template variables from
 * broadbanner.config.json, read every scheduled-task spec, substitute
 * {{VARS}}, validate, and emit a normalized JSON plan. The skill then loops
 * over the plan and calls the Cowork scheduler MCP tools (create/update),
 * which only Claude can do.
 *
 * Written as plain Node ESM (no TypeScript build step, no external deps) so it
 * runs cold in any environment that has `node` — a scheduled-task installer
 * must not depend on `npx tsx` + a package install to function.
 *
 * Usage:
 *   node collect-tasks.mjs [--project <path>] [--scaffold] [--list]
 *                          [--brand-slug <s>] [--substack-username <s>] ...
 *
 * Options:
 *   --project <path>  Project root (default: walk up from CWD to the nearest
 *                     broadbanner.config.json).
 *   --scaffold        Copy any shipped templates that the project is missing
 *                     into <root>/.broadbanner/scheduled-tasks/, then continue.
 *   --list            Human-readable table instead of JSON.
 *
 *   Connector/no-CLI mode — broadbanner.config.json is OPTIONAL. When it is
 *   absent (a creator who never ran `banner-admin init`), the brand-scoped
 *   template vars come from these flags instead, which the install-scheduled-tasks
 *   skill fills from the MCP connector's get_creator_context:
 *     --basename <s>           PROJECT_BASENAME / task-id label (default: dir name)
 *     --brand-slug <s>         BRAND_SLUG / BRAND_ID / POD_PREFIX
 *     --brand-display <s>      BRAND_DISPLAY
 *     --substack-username <s>  SUBSTACK_USERNAME
 *     --chrome-profile <s>     CHROME_PROFILE
 *     --pod-ids <a,b,c>        POD_IDS (comma-separated)
 *   Flags win over config when both are present.
 *
 *   Release cadence — the release-substack-{text,clips} templates pull their
 *   cronExpression from {{TEXT_RELEASE_CRON}} / {{CLIP_RELEASE_CRON}}, resolved
 *   from a named preset so a low-frequency creator isn't stuck on the heavy
 *   default. Pick one of high | medium | low (default: medium):
 *     --cadence <preset>       high (busy) | medium (default) | low (light)
 *     --text-cron <expr>       raw override for {{TEXT_RELEASE_CRON}} (advanced)
 *     --clip-cron <expr>       raw override for {{CLIP_RELEASE_CRON}} (advanced)
 *   Config equivalent: { "scheduling": { "cadence": "low", "textCron"?, "clipCron"? } }.
 *   Resolution: raw flag > raw config > preset. A literal cron typed straight
 *   into a scaffolded spec also still wins (it's not a {{VAR}}).
 *
 * Output (default): a JSON object
 *   { projectRoot, projectBasename, specDir, vars, tasks[], warnings[] }
 * where each task is
 *   { id, description, cronExpression?|fireAt?, enabled, prompt, sourceFile }
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(SCRIPT_DIR, "..", "references", "templates");
const SPEC_SUBPATH = path.join(".broadbanner", "scheduled-tasks");

// ── arg parsing ──────────────────────────────────────────────────────────────
// String-valued flags map to opts keys; both `--flag value` and `--flag=value`
// forms are accepted. Override flags let the skill supply connector-derived vars
// when there is no broadbanner.config.json.
const STRING_FLAGS = {
  "--project": "project",
  "--basename": "basename",
  "--brand-slug": "brandSlug",
  "--brand-display": "brandDisplay",
  "--substack-username": "substackUsername",
  "--chrome-profile": "chromeProfile",
  "--pod-ids": "podIds",
  "--cadence": "cadence",
  "--text-cron": "textCron",
  "--clip-cron": "clipCron",
};

function parseArgs(argv) {
  const opts = {
    project: null,
    scaffold: false,
    list: false,
    basename: null,
    brandSlug: null,
    brandDisplay: null,
    substackUsername: null,
    chromeProfile: null,
    podIds: null,
    cadence: null,
    textCron: null,
    clipCron: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    let matched = false;
    for (const [flag, key] of Object.entries(STRING_FLAGS)) {
      if (a === flag) {
        opts[key] = argv[++i];
        matched = true;
        break;
      }
      if (a.startsWith(flag + "=")) {
        opts[key] = a.slice(flag.length + 1);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (a === "--scaffold") opts.scaffold = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else process.stderr.write(`warning: unknown option ${a}\n`);
  }
  return opts;
}

// ── project resolution ───────────────────────────────────────────────────────
function findProjectRoot(start) {
  let dir = path.resolve(start);
  const { root } = path.parse(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, "broadbanner.config.json"))) return dir;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function loadConfig(root) {
  const p = path.join(root, "broadbanner.config.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    process.stderr.write(`warning: could not parse ${p}: ${err.message}\n`);
    return {};
  }
}

// ── release cadence presets ───────────────────────────────────────────────────
// The release-substack-{text,clips} templates reference {{TEXT_RELEASE_CRON}} /
// {{CLIP_RELEASE_CRON}} instead of a hard-coded cron, so a creator picks one word
// (high | medium | low) instead of hand-tuning two cron strings. Text release
// fast-exits when nothing is pending, so its cost scales with run count — the
// reason a low-frequency creator wants a lighter cadence than the busy default.
const CADENCE_PRESETS = {
  // Busy publication: near-queue parity, around the clock.
  high: { TEXT_RELEASE_CRON: "*/2 * * * *", CLIP_RELEASE_CRON: "*/15 8-22 * * *" },
  // Default: every ~30 min for text, hourly 8am–10pm for clips.
  medium: { TEXT_RELEASE_CRON: "*/30 * * * *", CLIP_RELEASE_CRON: "0 8-22 * * *" },
  // Light: a handful of passes a day — lowest usage, highest lag.
  low: { TEXT_RELEASE_CRON: "0 9-21 * * *", CLIP_RELEASE_CRON: "0 10,14,18 * * *" },
};
const DEFAULT_CADENCE = "medium";

// Resolve the two release crons from (in order): a raw override (flag/config),
// then the named preset. An unknown cadence name warns and falls back to medium.
function resolveReleaseCrons(cfg, opts, warnings) {
  const sched = (cfg && cfg.scheduling) || {};
  let name = opts.cadence || sched.cadence || DEFAULT_CADENCE;
  if (!Object.prototype.hasOwnProperty.call(CADENCE_PRESETS, name)) {
    warnings.push(
      `unknown cadence "${name}" — expected high|medium|low; using ${DEFAULT_CADENCE}`,
    );
    name = DEFAULT_CADENCE;
  }
  const preset = CADENCE_PRESETS[name];
  return {
    TEXT_RELEASE_CRON: opts.textCron || sched.textCron || preset.TEXT_RELEASE_CRON,
    CLIP_RELEASE_CRON: opts.clipCron || sched.clipCron || preset.CLIP_RELEASE_CRON,
  };
}

// ── template variables, derived from config + override flags ──────────────────
// Override flags (opts.*) win over broadbanner.config.json, which is itself
// optional — a creator on the connector/no-CLI path has no config, so the skill
// passes the brand-scoped vars in from the MCP connector's get_creator_context.
function deriveVars(root, cfg, opts = {}, warnings = []) {
  const basename = opts.basename || path.basename(root);
  const brandSlug =
    opts.brandSlug ||
    (cfg.user && cfg.user.brandSlugs && cfg.user.brandSlugs[0]) ||
    (cfg.brands && cfg.brands[0] && cfg.brands[0].id) ||
    "";
  const brandDisplay =
    opts.brandDisplay || (cfg.brands && cfg.brands[0] && cfg.brands[0].displayName) || "";
  const chromeProfile =
    opts.chromeProfile ||
    (cfg.chromeProfiles &&
      cfg.chromeProfiles.byBrand &&
      cfg.chromeProfiles.byBrand[brandSlug]) ||
    brandDisplay ||
    "";
  const podIds =
    opts.podIds != null
      ? opts.podIds.split(",").map((s) => s.trim()).filter(Boolean)
      : (cfg.user && cfg.user.effectivePodIds) || [];
  return {
    PROJECT_BASENAME: basename,
    PROJECT_ROOT: `~/${basename}`,
    CREDS_DIR: `~/.broadbanner/${basename}`,
    BRAND_SLUG: brandSlug,
    BRAND_ID: opts.brandSlug || (cfg.brands && cfg.brands[0] && cfg.brands[0].id) || brandSlug,
    BRAND_DISPLAY: brandDisplay,
    POD_PREFIX: brandSlug ? `${brandSlug}-` : "",
    POD_IDS: podIds.join(", "),
    CHROME_PROFILE: chromeProfile,
    SUBSTACK_USERNAME: opts.substackUsername || (cfg.user && cfg.user.substackUsername) || "",
    ...resolveReleaseCrons(cfg, opts, warnings),
  };
}

function substitute(str, vars, warnings, where) {
  return String(str).replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    warnings.push(`unresolved variable {{${name}}} in ${where}`);
    return m;
  });
}

// ── minimal frontmatter parser (no YAML dependency) ──────────────────────────
function parseSpec(raw) {
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, body: raw.trim() };
  }
  // Find the closing '---' on its own line.
  const lines = raw.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter: {}, body: raw.trim() };

  const fm = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Strip a matching pair of surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  const body = lines.slice(end + 1).join("\n").trim();
  return { frontmatter: fm, body };
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coerceBool(v, dflt) {
  if (v === undefined || v === null || v === "") return dflt;
  if (typeof v === "boolean") return v;
  return /^(true|yes|1|on)$/i.test(String(v).trim());
}

// ── scaffold ─────────────────────────────────────────────────────────────────
function scaffold(specDir, warnings) {
  const copied = [];
  if (!fs.existsSync(TEMPLATES_DIR)) {
    warnings.push(`no templates dir at ${TEMPLATES_DIR}`);
    return copied;
  }
  fs.mkdirSync(specDir, { recursive: true });
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    if (!f.endsWith(".md")) continue;
    const dest = path.join(specDir, f);
    if (fs.existsSync(dest)) continue; // never clobber project specs
    fs.copyFileSync(path.join(TEMPLATES_DIR, f), dest);
    copied.push(f);
  }
  return copied;
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    process.stdout.write(
      "Usage: node collect-tasks.mjs [--project <path>] [--scaffold] [--list]\n" +
        "                              [--cadence high|medium|low] [--text-cron <expr>] [--clip-cron <expr>]\n",
    );
    return;
  }

  const root = opts.project
    ? path.resolve(opts.project.replace(/^~(?=$|\/)/, os.homedir()))
    : findProjectRoot(process.cwd());

  if (!root) {
    process.stderr.write(
      "error: no project root found (pass --project <path>)\n",
    );
    process.exit(1);
  }

  // broadbanner.config.json is OPTIONAL. With it (CLI path), vars are derived
  // from it. Without it (connector/no-CLI path), vars come from the override
  // flags the skill fills from the MCP connector's get_creator_context.
  const hasConfig = fs.existsSync(path.join(root, "broadbanner.config.json"));
  const cfg = hasConfig ? loadConfig(root) : {};
  const warnings = [];
  const vars = deriveVars(root, cfg, opts, warnings);
  const specDir = path.join(root, SPEC_SUBPATH);
  if (!hasConfig) {
    warnings.push(
      "no broadbanner.config.json — connector/no-CLI mode; brand-scoped vars come from override flags (the skill supplies them from get_creator_context). Pass --brand-slug for clip scoping.",
    );
    if (!vars.BRAND_SLUG) {
      warnings.push(
        "BRAND_SLUG is empty — clip release ({{BRAND_SLUG}}) won't be brand-scoped. Pass --brand-slug <slug> from get_creator_context.",
      );
    }
  }

  let scaffolded = [];
  if (opts.scaffold) scaffolded = scaffold(specDir, warnings);

  const tasks = [];
  const seenIds = new Set();
  if (fs.existsSync(specDir)) {
    const files = fs
      .readdirSync(specDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const f of files) {
      const full = path.join(specDir, f);
      const raw = fs.readFileSync(full, "utf8");
      const { frontmatter, body } = parseSpec(raw);

      const rawId = frontmatter.id
        ? substitute(frontmatter.id, vars, warnings, f)
        : f.replace(/\.md$/, "");
      const id = slugify(rawId);
      if (!id) {
        warnings.push(`${f}: could not derive a task id; skipped`);
        continue;
      }
      if (seenIds.has(id)) {
        warnings.push(`${f}: duplicate task id "${id}"; skipped`);
        continue;
      }
      const cron = frontmatter.cronExpression
        ? substitute(frontmatter.cronExpression, vars, warnings, f).trim()
        : "";
      const fireAt = frontmatter.fireAt
        ? substitute(frontmatter.fireAt, vars, warnings, f).trim()
        : "";
      if (cron && fireAt) {
        warnings.push(`${f}: has both cronExpression and fireAt; using cronExpression`);
      }
      const prompt = substitute(body, vars, warnings, f);
      if (!prompt.trim()) {
        warnings.push(`${f}: empty prompt body; skipped`);
        continue;
      }
      const description = substitute(
        frontmatter.description || id,
        vars,
        warnings,
        f,
      );

      const task = {
        id,
        description,
        enabled: coerceBool(frontmatter.enabled, true),
        prompt,
        sourceFile: path.relative(root, full),
      };
      if (cron) task.cronExpression = cron;
      else if (fireAt) task.fireAt = fireAt;
      // neither => ad-hoc (manual-run-only) task

      tasks.push(task);
      seenIds.add(id);
    }
  } else if (!opts.scaffold) {
    warnings.push(
      `no spec dir at ${path.relative(root, specDir)} — run with --scaffold to create it from templates`,
    );
  }

  if (opts.list) {
    process.stdout.write(`\nProject: ${vars.PROJECT_BASENAME}  (${root})\n`);
    process.stdout.write(`Spec dir: ${path.relative(root, specDir)}\n`);
    process.stdout.write(
      `Release cadence: text ${vars.TEXT_RELEASE_CRON} | clips ${vars.CLIP_RELEASE_CRON}\n`,
    );
    if (scaffolded.length) {
      process.stdout.write(`Scaffolded: ${scaffolded.join(", ")}\n`);
    }
    process.stdout.write(`\nResolved tasks (${tasks.length}):\n`);
    for (const t of tasks) {
      const when = t.cronExpression
        ? `cron "${t.cronExpression}"`
        : t.fireAt
          ? `once @ ${t.fireAt}`
          : "ad-hoc (manual only)";
      process.stdout.write(
        `  • ${t.id}\n      ${when}   enabled=${t.enabled}\n      ${t.description}\n      ← ${t.sourceFile}\n`,
      );
    }
    if (warnings.length) {
      process.stdout.write(`\nWarnings:\n`);
      for (const w of warnings) process.stdout.write(`  ! ${w}\n`);
    }
    process.stdout.write("\n");
    return;
  }

  const out = {
    projectRoot: root,
    projectBasename: vars.PROJECT_BASENAME,
    specDir: path.relative(root, specDir),
    scaffolded,
    vars,
    tasks,
    warnings,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main();
