---
name: bb-scheduled-manager
description: "Install, update, or uninstall Cowork scheduled tasks for a BroadBanner project. REQUIRES an action — install (register/sync specs), update (re-sync or --refresh existing), or uninstall (remove tasks, optionally their specs). Use when the user says 'install/register/sync the scheduled tasks', 'update/refresh the scheduled tasks', 'uninstall/remove/delete/clean up the scheduled tasks', or 'set up scheduling'. Resolves per-project template vars and registers each via the Cowork scheduler, filed under the project it's run from."
---

# Manage Scheduled Tasks

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

**Run location is the Cowork _Home run-mode_ setting, not a per-task argument.** If
Cowork Home is on the beta **"run in cloud"** mode, every task you create runs in the
cloud and can never reach local Chrome. **Before installing, set Cowork Home to run on
your computer** (turn the beta "run in cloud" mode OFF); then every task files as a
local ("Runs on this computer") task. Verify each task shows **"Runs on this computer"**
after install (Step 4).

## ⚠️ Project filing — read first

A scheduled task is filed under the Cowork **project of the session that runs
this skill**. There is no project parameter on the create tool.

**Run this skill from the project the tasks belong to.** If the active project is
not the one whose tasks you are installing, stop and tell the user to switch to
that project's Cowork chat first. Confirm the match in Step 2 before creating
anything — installing into the wrong project is the exact bug this plugin fixes.

## Step 0 — Determine the action (install | update | uninstall)

This skill **requires an action**. Resolve it in order:

1. An explicit action in the invocation/args — `/bb-scheduled-manager install`,
   `/bb-scheduled-manager update`, `/bb-scheduled-manager uninstall`.
2. Else infer from the user's phrasing: "install / register / sync / set up" →
   **install**; "update / refresh / re-sync" → **update**; "uninstall / remove /
   delete / clean up" → **uninstall**.
3. If neither is present or it's ambiguous, **ask once**: "install, update, or
   uninstall the scheduled tasks?"

Then route:

- **install** → Steps 1–5 (locate project → collect specs → diff → create/update →
  report). Scaffolds missing specs. The default register/sync flow.
- **update** → the same flow as install, for a project whose tasks are already
  registered: re-sync schedule/enabled from specs, and — only when the user wants the
  shipped template content refreshed — run the collector with `--refresh` first
  (Step 2) to overwrite stale specs, then apply. The prompt-regression guard (Step 3)
  still holds: never replace a live task's prompt without explicit confirmation.
- **uninstall** → the **Uninstall / remove tasks** section below (skip Steps 2–5).

All three obey the **Project filing** rule — they act only on the active project's tasks.

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
`--refresh` only touches **spec files on disk** — it does **not** re-push to any
already-registered task. A live task's prompt is still only replaced later through
the Step 3 confirm-first regression guard, so refreshing a stale spec can't silently
revert a running task on its own.

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
- **update (schedule/enabled only)** — `id` exists but `cronExpression`/`fireAt`
  or `enabled` differs. Safe to apply — these don't touch the prompt.
- **unchanged** — `id` exists, schedule matches, enabled matches → skip.

> **⚠️ Never silently overwrite a live task's PROMPT — regression guard.**
> `list_scheduled_tasks` does **not** expose the stored prompt, so you **cannot see**
> whether the live task was hand-customized (brandless rewrite, tuned cadence, added
> notes). **By default, leave the prompt of an already-registered task ALONE.** Only
> replace a live prompt when the user *explicitly* asks to "refresh"/"reinstall the
> prompt" for that task — and even then, **warn first**: "I can't read the current
> task text, so this will blindly replace any manual edits on `<id>` with the spec
> version. Confirm?" Get a per-task (or explicit all-tasks) yes before pushing.
> This is the exact regression the operator hit — a reinstall reverting a
> deliberately-brandless clip task back to the template default. Default to
> preserving the live prompt; make replacing it a deliberate, confirmed act.

Present the plan to the user before mutating anything.

## Step 4 — Apply

> **⚠️ These tasks must run ON THIS COMPUTER (local), never in the cloud.**
> They drive local Chrome — a cloud-run task can never reach the browser and fails
> every fire. **Run location is governed by the Cowork _Home run-mode_ setting, not
> a per-task argument.** If Cowork Home is set to the beta **"run in cloud"** mode,
> **every** task you create runs in the cloud regardless of which session you
> installed from. **Before installing, set Cowork Home to run on your computer**
> (turn the beta "run in cloud" mode OFF); then every task files as a local
> ("Runs on this computer") task. There is no reliable per-task override — the Home
> run-mode is the control. (If a future build *does* expose a run-location argument
> on `create_scheduled_task`, set it to the local option too, but don't rely on it.)

For each task in the plan:

- **create:** call `create_scheduled_task` with `taskId` = `id`, `description`,
  `prompt`, and **either** `cronExpression` **or** `fireAt` (never both; omit both
  for an ad-hoc task). If the spec's `enabled` is `false`, immediately follow with
  `update_scheduled_task` `{ taskId, enabled: false }`.
- **update:** call `update_scheduled_task` with only the changed **schedule/state**
  fields (`cronExpression`/`fireAt`, `enabled`, and `description`). **Do NOT include
  `prompt`** unless the user explicitly confirmed a prompt-refresh for that task per
  the Step 3 regression guard — replacing a live prompt blindly can revert a
  hand-customized task.
- **enable/disable:** `update_scheduled_task` with `{ taskId, enabled }`.

Recurring tasks apply a few minutes of dispatch jitter — the resulting run time
may differ slightly from the cron minute. That's expected.

### Verify run location (do NOT skip)

After creating, confirm via `list_scheduled_tasks` (or the Cowork scheduled-tasks
sidebar) that **every** task reports **"Runs on this computer"**. If any task is
filed as **"Runs in cloud"**, it is broken — a cloud task cannot reach local Chrome.
The cause is almost always the **Cowork Home run-mode set to the beta "run in cloud"
mode**: tell the user to switch Home to run on their computer, then **delete and
recreate** the affected tasks (a cloud-created task keeps its location). Report the
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

## Uninstall / remove tasks

When the user asks to **"uninstall / remove / delete / clean up the scheduled
tasks"** (rather than install), run this flow instead of Steps 2–5. Same
**project-filing rule** applies: you can only remove tasks filed under the **active
project's** session, so run this from that project's Cowork chat.

### U1 — Determine which tasks to remove

Call `list_scheduled_tasks`. Select this project's tasks — they're the ones whose
`taskId` ends with the project's basename suffix (the templates mint ids like
`release-substack-clips-<PROJECT_BASENAME>`, `schedule-substack-live-<PROJECT_BASENAME>`,
etc.). Optionally run the collector (`collect-tasks.mjs --list`) to get the exact
ids the project's current specs would produce — but **match on the live list**, not
only the specs, so you also catch tasks whose spec was already deleted (e.g. the
retired `drain-clip-queue-*` / `refill-clip-queue-*` pair).

Scope options, in order of what the user asked:

- **A specific task** they named → just that `taskId`.
- **"the retired/old ones"** → the disabled/legacy tasks (e.g. `drain-clip-queue-*`,
  `refill-clip-queue-*`).
- **"all the scheduled tasks" for this project** → every task with this project's
  basename suffix. **Never** remove tasks belonging to another project.

### U2 — Confirm before deleting (always)

Deletion is destructive and not undoable from here. **List the exact tasks you're
about to delete** (id + description + schedule) and get an explicit **yes**. Do not
proceed on ambiguity — if the scope is unclear, ask.

### U3 — Delete each task

For each confirmed task, call the Cowork scheduler's **delete tool**
(`delete_scheduled_task { taskId }` — use whatever the scheduled-tasks MCP names it;
it's the inverse of `create_scheduled_task`). If no delete tool is available in this
environment, **stop and tell the user to remove the task from the Cowork
scheduled-tasks sidebar manually** (the trash icon), and list exactly which ids.
Do not try to "disable" as a substitute for delete unless the user asked to pause
rather than remove.

### U4 — Offer to remove the spec file(s)

A registered task and its **spec file** (`<PROJECT_ROOT>/.broadbanner/scheduled-tasks/<name>.md`)
are separate. Deleting the task does NOT delete the spec — and if the spec remains, a
future `bb-scheduled-manager install` run will **recreate** the task. So after deleting,
**ask** whether to also delete the matching spec file(s):

- **Yes** → remove the spec file so it won't be reinstalled.
- **No / keep** (default when unsure) → leave the spec; warn that re-running install
  will recreate the task. Specs are versioned project files the user may want to keep.

Never delete a spec the user didn't confirm.

### U5 — Report

Summarize: each `taskId` deleted (or "manual removal needed" if no delete tool),
and for each, whether its spec file was removed or kept. Note any leftover specs
that would recreate a task on the next install.

## Spec format & variables

See `references/spec-format.md` for the full frontmatter schema, the
`cronExpression`-vs-`fireAt` rules, and the `{{VAR}}` list. Those vars resolve
from `broadbanner.config.json` when it exists, otherwise from the collector's
override flags (`--brand-slug`, `--substack-username`, `--basename`, …) — which
this skill fills from the connector's `get_creator_context` on the no-CLI path.
This engine bundles the **release pair** templates (`release-substack-text`,
`release-substack-clips`, banner_blast/Core) in its own `references/templates/` — the
default `--scaffold` source. The **auto-scheduling pair** (`schedule-substack-live`,
`schedule-restream-live`) is the **Pre-Production Assistant** add-on and ships in the
**`broadbanner-pre-production`** plugin; its `auto-schedule-lives` skill installs them
through this engine by passing `--templates-dir <its templates>`. All templates are
**connector-only** (BroadBanner MCP connector; no `broadbanner.config.json`, no
`.creds/gateway.token`, no mount). The collector resolves brand-scoped vars from
`broadbanner.config.json` when present, otherwise from the connector-derived override flags.

## Expanding

To add a new scheduled task for a brand, the user drops a new `<name>.md` spec in
that project's `.broadbanner/scheduled-tasks/` and re-runs this skill from that
project. No plugin change is needed. New org-wide templates go in
`references/templates/`.
