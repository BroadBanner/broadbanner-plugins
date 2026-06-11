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
 *
 * Options:
 *   --project <path>  Project root (default: walk up from CWD to the nearest
 *                     broadbanner.config.json).
 *   --scaffold        Copy any shipped templates that the project is missing
 *                     into <root>/.broadbanner/scheduled-tasks/, then continue.
 *   --list            Human-readable table instead of JSON.
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
function parseArgs(argv) {
  const opts = { project: null, scaffold: false, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") opts.project = argv[++i];
    else if (a.startsWith("--project=")) opts.project = a.slice("--project=".length);
    else if (a === "--scaffold") opts.scaffold = true;
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

// ── template variables, derived from config ──────────────────────────────────
function deriveVars(root, cfg) {
  const basename = path.basename(root);
  const brandSlug =
    (cfg.user && cfg.user.brandSlugs && cfg.user.brandSlugs[0]) ||
    (cfg.brands && cfg.brands[0] && cfg.brands[0].id) ||
    "";
  const brandDisplay = (cfg.brands && cfg.brands[0] && cfg.brands[0].displayName) || "";
  const chromeProfile =
    (cfg.chromeProfiles &&
      cfg.chromeProfiles.byBrand &&
      cfg.chromeProfiles.byBrand[brandSlug]) ||
    brandDisplay ||
    "";
  const podIds = (cfg.user && cfg.user.effectivePodIds) || [];
  return {
    PROJECT_BASENAME: basename,
    PROJECT_ROOT: `~/${basename}`,
    CREDS_DIR: `~/.broadbanner/${basename}`,
    BRAND_SLUG: brandSlug,
    BRAND_ID: (cfg.brands && cfg.brands[0] && cfg.brands[0].id) || brandSlug,
    BRAND_DISPLAY: brandDisplay,
    POD_PREFIX: brandSlug ? `${brandSlug}-` : "",
    POD_IDS: podIds.join(", "),
    CHROME_PROFILE: chromeProfile,
    SUBSTACK_USERNAME: (cfg.user && cfg.user.substackUsername) || "",
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
      "Usage: node collect-tasks.mjs [--project <path>] [--scaffold] [--list]\n",
    );
    return;
  }

  const root = opts.project
    ? path.resolve(opts.project.replace(/^~(?=$|\/)/, os.homedir()))
    : findProjectRoot(process.cwd());

  if (!root || !fs.existsSync(path.join(root, "broadbanner.config.json"))) {
    process.stderr.write(
      "error: no broadbanner.config.json found (pass --project <path>)\n",
    );
    process.exit(1);
  }

  const cfg = loadConfig(root);
  const vars = deriveVars(root, cfg);
  const specDir = path.join(root, SPEC_SUBPATH);
  const warnings = [];

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
