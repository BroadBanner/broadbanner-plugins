# BroadBanner Pre-Production Plugin

**Pre-Production Assistant** — the Production+ `pre_production_assistant` add-on ($5/mo,
cap `scheduling:auto`). Auto-schedules your live shows on Substack and Restream on a
recurring basis: the **unattended automation** of the manual schedule-live skills.

## What it is

The billing catalog splits "scheduling" in two:

- **Manual** live scheduling (`substack-schedule-live`, `restream-schedule-live`) is the
  Creator+ `creator_workspace` capability — you run it and it schedules your ready shows.
  Those skills live in `broadbanner-live-production` and are unchanged.
- **Automated** live scheduling is *this* add-on: recurring scheduled tasks that run
  those skills on a daily cron so shows get scheduled without you doing anything.

## Skills

| Skill | Description |
|---|---|
| `auto-schedule-lives` | Gated front door for the add-on. Preflights the `pre_production_assistant` entitlement, then delegates to the `broadbanner-scheduled-tasks` engine (`/bb-scheduled-manager install`) to scaffold + register the two auto-scheduling tasks from this plugin's templates. |

## How it works

This plugin ships the two auto-scheduling task templates in `references/templates/`
(`schedule-substack-live.md`, `schedule-restream-live.md`). It does **not** reimplement
the scheduler — it installs them through the shared **`broadbanner-scheduled-tasks`**
engine by passing `--templates-dir <this plugin's templates>` to its collector, reusing
all spec-resolution, cadence, `--refresh`, and prompt-regression-guard logic.

## Requirements

- **Production+** with the **Pre-Production Assistant** add-on (`pre_production_assistant`).
  The skill preflights this and points you to the member portal if unmet.
- The **`broadbanner-scheduled-tasks`** plugin installed (the engine this delegates to).
- **Desktop Cowork on a local machine**, Cowork Home set to "run on your computer" (not
  the beta cloud mode) — these are browser-automation tasks that drive local Chrome and
  cannot run in the cloud.
- The **BroadBanner MCP connector** connected, on a session authorized to schedule.
- The single BroadBanner Chrome profile logged into Substack (and Restream Studio).

## Related

- `broadbanner-scheduled-tasks` — the generic install/update/uninstall engine.
- `broadbanner-live-production` — the manual (Creator+) schedule-live skills this automates.
