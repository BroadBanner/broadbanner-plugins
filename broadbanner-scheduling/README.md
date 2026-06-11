# BroadBanner Scheduling Plugin

Scheduled-task management for BroadBanner Cowork projects.

## Why this exists

`banner-admin install-schedules` only **writes** `SKILL.md` files into
`~/Documents/Claude/Scheduled/`. The current Cowork scheduler does **not**
auto-discover dropped files — a task only becomes real (registered, enabled,
visible in the sidebar) when it is created through Cowork's own
`create_scheduled_task` tool. The CLI runs outside Cowork and cannot call that
tool, so file-drop alone never registers anything.

This plugin closes that gap. Its skill reads **declarative task specs** from the
active project and registers each one via `create_scheduled_task`, so the task
is filed under the project the skill is run from.

> **Project filing rule:** a scheduled task is filed under the Cowork project of
> the session that creates it. There is no project parameter on the create tool.
> **Run this skill from the project you want the tasks to live in.** Running it
> from a different project files the tasks in the wrong place.

## Skills

| Skill | Description |
|---|---|
| `install-scheduled-tasks` | Read declarative scheduled-task specs from `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/*.md`, resolve per-project template variables, and create/update them in the Cowork scheduler. Idempotent: existing tasks are updated only when they differ. Run from the target project. |

## Task specs

Specs live in the **project repo**, not the plugin, so they are versioned with
the brand they belong to:

```
<PROJECT_ROOT>/.broadbanner/scheduled-tasks/
├── schedule-substack-live.md
├── schedule-restream-live.md
└── <your-custom-task>.md
```

Each spec is a self-contained Markdown file: YAML frontmatter
(`id`, `description`, `cronExpression` **or** `fireAt`, `enabled`) plus a body
that is the prompt executed on each run. Bodies may use `{{VARS}}`
(e.g. `{{POD_PREFIX}}`, `{{PROJECT_ROOT}}`) which are resolved per-project from
`broadbanner.config.json`. See
[`skills/install-scheduled-tasks/references/spec-format.md`](skills/install-scheduled-tasks/references/spec-format.md)
for the full schema and variable list.

Ready-made templates for the live-scheduling pair ship in
[`skills/install-scheduled-tasks/references/templates/`](skills/install-scheduled-tasks/references/templates/).
The skill can scaffold them into a project that has none yet
(`collect-tasks.mjs --scaffold`).

## Expanding it

To add a new scheduled task to a brand: drop a new `<name>.md` spec into that
project's `.broadbanner/scheduled-tasks/`, then run `install-scheduled-tasks`
from that project. No plugin changes required. To add a new **reusable**
template for all brands, add it under `references/templates/`.

## Requirements

- Cowork with the `scheduled-tasks` MCP (`create_scheduled_task`,
  `update_scheduled_task`, `list_scheduled_tasks`).
- A BroadBanner project with `broadbanner.config.json` at its root.
- `node` on PATH for the collector script (zero external dependencies).
