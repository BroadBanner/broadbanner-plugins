# Operator Runbook — Install & Manage BroadBanner Scheduled Tasks

A repeatable, machine-independent procedure for standing up and managing the
recurring BroadBanner tasks (clip release, text release, live scheduling) in
Cowork. Everything here goes through the **canonical install path** — committed
spec files registered by the `manage` skill. You never hand-edit
the Cowork scheduler or drop files into a project from a one-off session; that is
exactly the failure mode this plugin exists to prevent.

> **Golden rule:** a task only becomes real when `manage install` runs
> **from the Cowork session of the project the task belongs to**. The scheduler
> files a task under whichever project created it — there is no project
> parameter. Run the skill from the right project, every time.

> **⚠️ Local machine only.** Every task here drives a **local Chrome browser** via
> the Claude-in-Chrome connection (Substack/Restream have no API). They **cannot
> run on a cloud/headless agent** — install and run them from **desktop Cowork on
> the machine where the single BroadBanner Chrome profile stays open and logged in**
> at fire time. A run with no connected browser stops and reports; nothing goes out.

---

## 0. Prerequisites (once per machine / workspace)

1. **Plugins installed in Cowork** — `broadbanner-social-distribution` (the
   `release-substack-clips` / `release-substack-text` skills),
   `broadbanner-live-production` (the `schedule-substack-live` /
   `restream-schedule-live` skills), and `broadbanner-scheduled-tasks` (this plugin).
   Install from the public marketplace via the **Cowork UI** — no local
   credentials. (The `/plugin …` slash commands are **Claude Code only** and do
   **not** work in Cowork.) In the Cowork section:

   > **Customize → the `+` next to "Personalize Plugins" → Create plugin → Add
   > marketplace → Add from a repository**

   When prompted for the repository, enter `BroadBanner/broadbanner-plugins`,
   then install `broadbanner-social-distribution`, `broadbanner-live-production`,
   and `broadbanner-scheduled-tasks` from that marketplace. Manage/update them later
   from the same "Personalize Plugins" panel. (`broadbanner-live-production` was
   renamed from `broadbanner-restream`; if you have the old one, install the new
   name and remove it. First-time machine setup for the CLIs and per-service auth:
   see `Documentation/guides/broadbanner-cli-setup-guide.docx` and the numbered
   per-service guides.)
2. **BroadBanner MCP connector connected** — Cowork → Settings → Connectors → Add
   custom connector → `https://mcp.broadbanner.com/mcp` → sign in via WorkOS with
   **that workspace's creator email**. The connector provides identity, the clip
   list, and the Substack handle; there are no local credentials.
3. **A Cowork project to host the tasks** — scheduled tasks are filed under the
   Cowork project of the session that installs them, so you need one (the name is
   just a label). `broadbanner.config.json` at its root is **optional**:
   - **CLI-initialized** (`banner-admin init` wrote the config): template vars
     (`{{PROJECT_BASENAME}}`, `{{BRAND_SLUG}}`, `{{POD_PREFIX}}`, …) resolve from
     it automatically.
   - **Connector-only / no-CLI** (no config): the `manage` skill
     pulls the brand slug + Substack handle from the MCP connector
     (`get_creator_context`) and passes them to the collector — no config file
     needed. **All four templates are now connector-only** (the
     `schedule-substack-live` / `restream-schedule-live` pair no longer needs a
     `broadbanner.config.json` or a gateway token — the old CLI-initialized
     requirement is retired).

The browser Cowork drives must be logged into the Substack account (and, for the
Restream task, Restream Studio) the task acts on — the single connected BroadBanner
Chrome profile, logged into the `substackHandle` the connector resolves for that
workspace/brand. There is no per-brand profile routing; the skills use the one
connected browser and verify the account.

---

## 1. The model (read once)

- **One spec file = one scheduled task.** Specs live **in the project repo** at
  `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/*.md`, versioned with the brand —
  not in this plugin. That is what makes them portable: clone the project on any
  machine and the specs come with it.
- A spec is YAML frontmatter (`id`, `description`, `cronExpression` **or**
  `fireAt`, `enabled`) plus a Markdown body that is the prompt run on each fire.
  See [`skills/manage/references/spec-format.md`](skills/manage/references/spec-format.md).
- **`banner-admin install-schedules` only writes files; it does not register
  anything.** Registration is the `manage` skill calling Cowork's
  `create_scheduled_task`. The CLI cannot call that tool.

---

## 2. Install / update tasks for a project

Do this from **that project's Cowork chat** (not Claude Code, not another
project):

1. Make sure the specs exist under `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/`.
   If the directory is empty, the skill offers to **scaffold** the shipped
   templates (`release-substack-clips`, `release-substack-text`,
   `schedule-substack-live`, `schedule-restream-live`) — accept, then review each
   scaffolded spec (especially `cronExpression` and the brand scoping).
2. Say **"install the scheduled tasks"** to run `manage install`.
3. It collects the specs, resolves `{{VARS}}` from `broadbanner.config.json`,
   diffs against what's already registered (`list_scheduled_tasks`), and shows a
   create/update/unchanged plan. Approve it.
4. For any task that drives a browser/connector, click **Run now** once so tool
   approvals are captured — otherwise the first scheduled run pauses on a
   permission prompt.

The skill is **idempotent**: re-running only creates new tasks and updates ones
whose schedule/enabled/prompt changed. Safe to run anytime.

## 3. Manage existing tasks

| Action | How |
| --- | --- |
| **Change schedule / prompt** | Edit the spec `.md`, commit, re-run `manage install` (or `manage update`) from that project. |
| **Pause** | Set `enabled: false` in the spec, re-run the skill (or toggle in the Cowork sidebar). |
| **List** | The skill calls `list_scheduled_tasks`; or view them in the Cowork scheduled-tasks sidebar. |
| **Add a new task** | Drop a new `<name>.md` spec in the project's `.broadbanner/scheduled-tasks/`, re-run the skill. No plugin change. |
| **Remove / uninstall** | Say **"uninstall the scheduled tasks"** (or "remove/delete task X") from that project's Cowork chat — `manage uninstall` runs the uninstall flow: it lists this project's tasks, confirms, deletes each via the scheduler, and asks whether to also delete the spec (leaving the spec recreates the task on the next install). You can still delete manually via the Cowork sidebar trash icon. |

---

## 4. Worked example — clip release (brandless default) and optional per-account routing

**How clip routing works.** Each clip fans out to **every enrolled host's
workspace**, so the same clip exists once per workspace, each copy with its **own**
Substack status slot. A task posts *its workspace's copy* to *one* account and marks
only that copy released. So you route each copy independently — that is how one clip
can reach two accounts with no double-post.

**The shipped `release-substack-clips` template is now BRANDLESS by default** — it
passes no `brand`, so it releases *all* of that identity's pending clips to their one
default Substack handle. That is the right default for a personal/creator hub (one
person, one account). Brand-scoping is an **opt-in** for the multi-account case
below.

Goal: put `babm-afbc` (Banner & Backbone) clips on **both** `@bannerandbackbone`
(the show account) **and** `@nickparo` (the personal account).

### 4a. NickParo project → `@nickparo` (brandless — the default)

`@nickparo` is your **default** handle, reached by a **brandless** run (the shipped
template). Just scaffold `release-substack-clips` in the NickParo project — no brand,
no config needed — and it releases *all* of your pending clips (every brand you host)
to `@nickparo`. Spec file:
`<NickParo>/.broadbanner/scheduled-tasks/release-substack-clips.md`.

### 4b. BannerAndBackboneMedia project → `@bannerandbackbone` (brand-scoped — opt-in)

To also land `babm` clips on the *separate* `@bannerandbackbone` account, run a
**brand-scoped** clip task from that brand's own workspace. The shipped template is
brandless, so add a **custom** spec that passes `brand: babm` —
`<BannerAndBackboneMedia>/.broadbanner/scheduled-tasks/release-substack-clips-babm.md`
with a body like the personal one below but invoking the skill **`for the babm
brand` — pass `brand: babm`**. It then lists only `babm` clips and posts them to
`@bannerandbackbone`. (Only do this if you genuinely run a separate account per
brand; otherwise the brandless default already covers you.)

Custom brandless spec (for reference — same as the shipped default, shown so you can
copy/customize):

```markdown
---
id: release-substack-clips-personal-nickparo
description: Release NickParo's pending video clips to the personal @nickparo Substack (brandless — all brands).
cronExpression: "*/30 9-21 * * *"
enabled: true
---
You are a recurring background poller running every ~30 minutes between 9am and 9pm
local time, releasing this workspace's queued video clips to the personal Substack
account. Invoke the `release-substack-clips` skill from the
`broadbanner-social-distribution` plugin **with NO brand argument** — do not pass
`brand`. Brandless resolves your default Substack handle (`@nickparo`) via the
BroadBanner connector and lists all of your pending clips, so clips from every
brand you host (including `babm-afbc`) post to `@nickparo`. This run is pre-approved
to run autonomously — do NOT pause for per-clip confirmation. The skill posts at
most 2 clips per run; the `*/30` cron drips the rest out over the day. The common
case (nothing pending) fast-exits without opening a browser.

This is the personal cross-post lane. The same clips also post to their brand
account from that brand's own workspace task (e.g. BannerAndBackboneMedia →
`@bannerandbackbone`); each workspace posts its own copy, so there is no
double-post on either account.
```

Then, **in each project's Cowork chat**, run `manage install`. Result:
the BannerAndBackboneMedia copy → `@bannerandbackbone`, the NickParo copy →
`@nickparo`. Same clips, both accounts.

> **Heads-up:** the brandless NickParo task posts *every* clip this identity has
> pending to `@nickparo` (not just `babm`). Since `@nickparo` is your default
> account that is usually intended; if you run a separate per-brand workspace for
> another brand's account, keep that brand's clips out of the brandless lane by
> routing them from their own workspace instead.

### Cadence reference (don't conflate them)

The release pair's schedule comes from a **cadence preset** chosen at install
(`manage` → `collect-tasks.mjs --cadence high|medium|low`,
default `medium`). The templates carry `{{TEXT_RELEASE_CRON}}` /
`{{CLIP_RELEASE_CRON}}` rather than a fixed cron, so the same spec serves a busy
publication and a light one — reinstall with a different `--cadence` to change the
frequency, or hand-edit a spec's `cronExpression` to a literal for full control.

| Task | `high` | `medium` (default) | `low` | Cap |
| --- | --- | --- | --- | --- |
| `release-substack-clips` (video) | `*/15 8-22 * * *` | `0 8-22 * * *` (hourly, 8a–10p) | `0 10,14,18 * * *` | 2 clips/run |
| `release-substack-text` (text) | `*/2 * * * *` (24/7) | `*/30 * * * *` | `0 9-21 * * *` | — |

Pick `low` for a low-frequency creator (fewest runs, highest lag), `high` for a
busy one (near-queue parity). Text release fast-exits when nothing is pending, so
its cost scales with run count — the reason the default moved off the old `*/2`.
