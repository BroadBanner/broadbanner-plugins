---
name: install-scheduled-tasks
description: "Install or update Cowork scheduled tasks for a BroadBanner project from declarative spec files. Use when the user says 'install the scheduled tasks', 'register scheduled tasks', 'set up scheduling', 'sync scheduled tasks', or after editing a spec in .broadbanner/scheduled-tasks/. Reads each spec, resolves per-project template variables, and registers it via the Cowork scheduler so it files under the project the skill is run from. Idempotent and expandable to any custom scheduled skill."
---

# Install Scheduled Tasks

Register a BroadBanner project's declarative scheduled-task specs into the Cowork
scheduler. Each spec under `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/*.md`
becomes one scheduled task created via `create_scheduled_task`.

This skill exists because `banner-admin install-schedules` only *writes* SKILL.md
files — the current Cowork scheduler does not auto-discover dropped files. Only a
call to `create_scheduled_task` actually registers a task. This skill makes that
call for every spec.

## ⚠️ Browser tasks are LOCAL-machine only — read first

The BroadBanner scheduled skills (`substack-schedule-live`, `restream-schedule-live`,
`release-substack-text`, `release-substack-clips`) all drive a **local Chrome
browser** through the Claude-in-Chrome connection — Substack and Restream Studio
have no posting/scheduling API, so the browser is load-bearing. These tasks
**cannot run on a cloud/headless agent**: register and run them from **desktop
Cowork on the machine where the single BroadBanner Chrome profile stays open and
logged in** at fire time. A scheduled run with no connected browser stops and
reports (nothing posted/scheduled).

**Two separate requirements — do both:** (1) run this install skill from an "on
your computer" desktop Cowork session, AND (2) create each task with its
**run-location set to "this computer"** (Step 4). Requirement (1) alone is NOT
enough — `create_scheduled_task` defaults to **cloud**, so a task installed from a
local session still lands as "Runs in cloud" unless you explicitly set the
run-location. Every task must show **"Runs on this computer"** when done.

## ⚠️ Project filing — read first

A scheduled task is filed under the Cowork **project of the session that runs
this skill**. There is no project parameter on the create tool.

**Run this skill from the project the tasks belong to.** If the active project is
not the one whose tasks you are installing, stop and tell the user to switch to
that project's Cowork chat first. Confirm the match in Step 2 before creating
anything — installing into the wrong project is the exact bug this plugin fixes.

## Step 1 — Locate the active project

Determine the active project root: the mounted workspace folder for this Cowork
project (e.g. `~/LevRemembers`). If you cannot identify it or it is not mounted,
call `request_cowork_directory` for it and wait.

Translate that to its bash-sandbox mount path for running the collector.

`broadbanner.config.json` in that folder is **optional**:

- **It's present** (a project set up with `banner-admin init`): the collector
  derives the brand-scoped template vars from it. Nothing extra to do.
- **It's absent** (a creator on the connector / no-CLI path): the brand-scoped
  vars come from the **MCP connector** instead. Call `get_creator_context` (the
  BroadBanner connector tool) and note the creator's **brand slug**, **Substack
  username**, and any **series ids** — you'll pass them to the collector in Step 2.
  If the connector isn't connected, stop and tell the user to add it first
  (Settings → Connectors → `https://mcp.broadbanner.com/mcp`).

## Step 2 — Collect the specs (deterministic)

Run the bundled collector. Its zero-dependency, so plain `node` is enough:

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>"
```

When there is **no `broadbanner.config.json`**, pass the connector-derived values
as flags. `--substack-username` is always useful (it's shown in the release tasks).
`--brand-slug` is **only** for the schedule-live pair's brand-isolation filter on a
**single-brand** workspace — the release tasks (text **and** clips) are **brandless**
and do not need it:

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>" \
  --substack-username "<handle from get_creator_context>" \
  # --brand-slug "<slug>"   # only if installing schedule-live for a single-brand workspace
```

**Do NOT pass a `--brand-slug` you merely guessed for a multi-brand / personal-hub
creator** (someone who hosts more than one brand, e.g. hosts series across BABM +
SOTSP + LR). The clip task is brandless by design — it releases *all* of that
creator's pending clips to their one default Substack handle. Baking in a single
brand would silently drain only that brand's clips.

To set how often the release pollers run, pass a cadence preset (the release
templates read their cron from it — `medium` is the default if you omit it):

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>" \
  --cadence low   # high (busy, 24/7) | medium (default) | low (light, ~daytime)
```

If the user asks to run the release tasks more or less often, that's this flag —
reinstall with a different `--cadence` and the schedules update in place. `high` ≈
text `*/2`, clips `*/15 8-22`; `medium` ≈ text `*/30`, clips hourly `0 8-22`; `low`
≈ text `0 9-21`, clips `0 10,14,18`. For a one-off custom schedule, pass
`--text-cron "<expr>"` / `--clip-cron "<expr>"` (or hand-edit the spec's
`cronExpression`). See `references/spec-format.md` → **Release cadence** for the
full table.

- `<SKILL_DIR>` is this skill's directory (from the skill location). If that path
  is not reachable from the bash sandbox, copy `scripts/collect-tasks.mjs` into
  the outputs dir and run it from there — it has no dependencies.
- Add `--list` instead of bare invocation for a human-readable preview (it prints
  the resolved release cadence so you can confirm before installing).
- The collector emits a warning when running without a config; an empty
  `BRAND_SLUG` only affects the schedule-live brand-isolation filter (the release
  tasks are brandless), so it's harmless for a personal hub.

Parse the JSON. **Confirm `projectBasename` is the project you intend to install
into.** If it is not, stop (see the filing warning above). Surface any
`warnings[]` to the user.

**Stale specs — use `--refresh`.** Spec files live in the *project*
(`.broadbanner/scheduled-tasks/`), and the collector **never overwrites** an
existing spec on a normal run. So after a plugin update, a project scaffolded from
older templates keeps running the **old** prompt text (e.g. stale profile wording,
a hard-coded brand, or a task the new version no longer skips). If the user reports
the installed task text looks out of date, or you've just upgraded the plugin,
re-scaffold from the current templates with **`--refresh`** (it overwrites the
shipped specs and lists what it replaced in `refreshed[]`; it does not touch specs
that aren't shipped templates):

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>" --refresh
```

Warn the user that `--refresh` replaces any local edits to the four shipped specs.

If `tasks[]` is empty because there is no spec directory yet, offer to scaffold
the shipped templates:

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>" --scaffold
```

Then tell the user which files were scaffolded and ask them to review each
spec — **especially `cronExpression` and the brand-scoping `{{POD_PREFIX}}`** —
before you register anything. Re-run the collector after they confirm.

## Step 3 — Diff against what's installed

Call `list_scheduled_tasks`. Build a map by `taskId`. For each collected task,
decide:

- **create** — `id` not in the installed list.
- **update** — `id` exists but `cronExpression`/`fireAt` differs from the
  installed schedule, or the user explicitly asked to refresh/reinstall.
- **enable/disable** — `id` exists but its `enabled` state differs from the spec.
- **unchanged** — `id` exists, schedule matches, enabled matches → skip.

(The installed list does not expose the stored prompt. On an explicit
"refresh"/"reinstall", update the prompt too; otherwise leave existing prompts
alone to avoid churn.)

Present the plan to the user before mutating anything.

## Step 4 — Apply

> **⚠️ Create every task to run ON THIS COMPUTER (local), never in the cloud.**
> These are browser-automation tasks that drive local Chrome — a cloud-run task
> can never reach the browser and fails every fire. Run location is a **per-task
> setting on the create call**, NOT a property of the session you install from:
> installing from an "on your computer" session is necessary but **not sufficient**;
> the create call still defaults to cloud unless you set it. **Inspect the
> `create_scheduled_task` tool's own parameter schema and set the run-location
> argument to the local / "this computer" option** (the field that drives the
> "Runs on this computer" vs "Runs in cloud" pill in the Cowork sidebar — e.g. a
> `runOn` / `location` / `runsLocally` / `device`-style parameter; use whatever
> your environment's schema actually names it). Do NOT accept the cloud default.

For each task in the plan:

- **create:** call `create_scheduled_task` with `taskId` = `id`, `description`,
  `prompt`, **the run-location argument set to local / "this computer"** (see the
  warning above), and **either** `cronExpression` **or** `fireAt` (never both; omit
  both for an ad-hoc task). If the spec's `enabled` is `false`, immediately follow
  with `update_scheduled_task` `{ taskId, enabled: false }`.
- **update:** call `update_scheduled_task` with only the changed fields
  (`cronExpression`/`fireAt`, `description`, `prompt`, `enabled`, **and the
  run-location if an existing task is filed as cloud** — see the verification below).
- **enable/disable:** `update_scheduled_task` with `{ taskId, enabled }`.

Recurring tasks apply a few minutes of dispatch jitter — the resulting run time
may differ slightly from the cron minute. That's expected.

### Verify run location (do NOT skip)

After creating/updating, confirm via `list_scheduled_tasks` (or the Cowork
scheduled-tasks sidebar) that **every** task reports **"Runs on this computer"**.
If any task is filed as **"Runs in cloud"**, it is broken — a cloud task cannot
reach local Chrome. Fix it: set the run-location to local via
`update_scheduled_task` if the tool supports it, otherwise **delete and recreate**
the task with the run-location argument set (per the warning above). Report the
final run location for each task in Step 5.

## Step 5 — Report

Print a summary table: each `taskId`, its schedule, the action taken
(created / updated / enabled / disabled / unchanged), and its **run location**
(must be "on this computer"). Echo any collector warnings. If any task still
reports "Runs in cloud" after the Step 4 verification, flag it loudly as broken —
it cannot reach the local browser.

For any task that drives a browser or remote connector, recommend the user click
**Run now** once so tool approvals are captured and future scheduled runs don't
pause on permission prompts.

## Spec format & variables

See `references/spec-format.md` for the full frontmatter schema, the
`cronExpression`-vs-`fireAt` rules, and the `{{VAR}}` list. Those vars resolve
from `broadbanner.config.json` when it exists, otherwise from the collector's
override flags (`--brand-slug`, `--substack-username`, `--basename`, …) — which
this skill fills from the connector's `get_creator_context` on the no-CLI path.
Ready-made templates for the release pair (`release-substack-text`,
`release-substack-clips`) and the live-scheduling pair (`schedule-substack-live`,
`schedule-restream-live`) are in `references/templates/`. **All four are now
connector-only** — they run on the **BroadBanner MCP connector** with no
`broadbanner.config.json`, no `.creds/gateway.token`, and no mount. (The release
pair lives in `broadbanner-social-distribution`; the live-scheduling pair lives in
`broadbanner-live-production` — install both plugins for a full set.) The collector
resolves brand-scoped vars from `broadbanner.config.json` when present, otherwise
from the connector-derived override flags.

## Expanding

To add a new scheduled task for a brand, the user drops a new `<name>.md` spec in
that project's `.broadbanner/scheduled-tasks/` and re-runs this skill from that
project. No plugin change is needed. New org-wide templates go in
`references/templates/`.
