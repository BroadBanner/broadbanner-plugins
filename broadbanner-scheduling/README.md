# BroadBanner Scheduling Plugin

Scheduled-task management for BroadBanner Cowork projects.

> **New operator? Start with [`OPERATOR-RUNBOOK.md`](OPERATOR-RUNBOOK.md)** — the
> step-by-step, machine-independent procedure for installing and managing these
> tasks, including a worked example of routing clip release to both a brand
> account and a personal Substack.

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

Ready-made templates ship in
[`skills/install-scheduled-tasks/references/templates/`](skills/install-scheduled-tasks/references/templates/)
for both the release pair (`release-substack-text`, `release-substack-clips` — from
`broadbanner-social-distribution`) and the live-scheduling pair
(`schedule-substack-live`, `restream-schedule-live` — from
`broadbanner-live-production`). All four are **connector-only** (BroadBanner MCP
connector — no `broadbanner.config.json`, no gateway token). The skill can scaffold
them into a project that has none yet (`collect-tasks.mjs --scaffold`).

## Expanding it

To add a new scheduled task to a brand: drop a new `<name>.md` spec into that
project's `.broadbanner/scheduled-tasks/`, then run `install-scheduled-tasks`
from that project. No plugin changes required. To add a new **reusable**
template for all brands, add it under `references/templates/`.

## Requirements

- **Desktop Cowork on a local machine.** The BroadBanner scheduled skills drive a
  **local Chrome browser** via the Claude-in-Chrome connection (Substack/Restream
  have no API), so these tasks **cannot run on a cloud/headless agent** — install
  and run them where the single BroadBanner Chrome profile stays open and logged in.
- Cowork with the `scheduled-tasks` MCP (`create_scheduled_task`,
  `update_scheduled_task`, `list_scheduled_tasks`).
- The **BroadBanner MCP connector** connected (`https://mcp.broadbanner.com/mcp`) —
  provides identity, context, and hosted data for the connector-only skills.
- A Cowork project to host the tasks. `broadbanner.config.json` at its root is
  **optional** — with it the collector derives brand-scoped vars automatically;
  without it (connector/no-CLI path) the skill supplies them from
  `get_creator_context`.
- `node` on PATH for the collector script (zero external dependencies).
