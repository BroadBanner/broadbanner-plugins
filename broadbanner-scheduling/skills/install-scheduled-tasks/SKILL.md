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

## ⚠️ Project filing — read first

A scheduled task is filed under the Cowork **project of the session that runs
this skill**. There is no project parameter on the create tool.

**Run this skill from the project the tasks belong to.** If the active project is
not the one whose tasks you are installing, stop and tell the user to switch to
that project's Cowork chat first. Confirm the match in Step 2 before creating
anything — installing into the wrong project is the exact bug this plugin fixes.

## Step 1 — Locate the active project

Determine the active project root: the mounted workspace folder containing
`broadbanner.config.json` (e.g. `~/LevRemembers`). If you cannot identify it or
it is not mounted, call `request_cowork_directory` for it and wait.

Translate that to its bash-sandbox mount path for running the collector.

## Step 2 — Collect the specs (deterministic)

Run the bundled collector. Its zero-dependency, so plain `node` is enough:

```bash
node "<SKILL_DIR>/scripts/collect-tasks.mjs" --project "<PROJECT_MOUNT_PATH>"
```

- `<SKILL_DIR>` is this skill's directory (from the skill location). If that path
  is not reachable from the bash sandbox, copy `scripts/collect-tasks.mjs` into
  the outputs dir and run it from there — it has no dependencies.
- Add `--list` instead of bare invocation for a human-readable preview.

Parse the JSON. **Confirm `projectBasename` is the project you intend to install
into.** If it is not, stop (see the filing warning above). Surface any
`warnings[]` to the user.

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

For each task in the plan:

- **create:** call `create_scheduled_task` with `taskId` = `id`, `description`,
  `prompt`, and **either** `cronExpression` **or** `fireAt` (never both; omit both
  for an ad-hoc task). If the spec's `enabled` is `false`, immediately follow with
  `update_scheduled_task` `{ taskId, enabled: false }`.
- **update:** call `update_scheduled_task` with only the changed fields
  (`cronExpression`/`fireAt`, `description`, `prompt`, `enabled`).
- **enable/disable:** `update_scheduled_task` with `{ taskId, enabled }`.

Recurring tasks apply a few minutes of dispatch jitter — the resulting run time
may differ slightly from the cron minute. That's expected.

## Step 5 — Report

Print a summary table: each `taskId`, its schedule, and the action taken
(created / updated / enabled / disabled / unchanged). Echo any collector
warnings.

For any task that drives a browser or remote connector, recommend the user click
**Run now** once so tool approvals are captured and future scheduled runs don't
pause on permission prompts.

## Spec format & variables

See `references/spec-format.md` for the full frontmatter schema, the
`cronExpression`-vs-`fireAt` rules, and the `{{VAR}}` list resolved from
`broadbanner.config.json`. Ready-made templates for the live-scheduling pair are
in `references/templates/`.

## Expanding

To add a new scheduled task for a brand, the user drops a new `<name>.md` spec in
that project's `.broadbanner/scheduled-tasks/` and re-runs this skill from that
project. No plugin change is needed. New org-wide templates go in
`references/templates/`.
