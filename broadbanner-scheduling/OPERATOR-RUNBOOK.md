# Operator Runbook — Install & Manage BroadBanner Scheduled Tasks

A repeatable, machine-independent procedure for standing up and managing the
recurring BroadBanner tasks (clip release, text release, live scheduling) in
Cowork. Everything here goes through the **canonical install path** — committed
spec files registered by the `install-scheduled-tasks` skill. You never hand-edit
the Cowork scheduler or drop files into a project from a one-off session; that is
exactly the failure mode this plugin exists to prevent.

> **Golden rule:** a task only becomes real when `install-scheduled-tasks` runs
> **from the Cowork session of the project the task belongs to**. The scheduler
> files a task under whichever project created it — there is no project
> parameter. Run the skill from the right project, every time.

---

## 0. Prerequisites (once per machine / workspace)

1. **Plugins installed in Cowork** — `broadbanner-social-distribution` (the
   `release-substack-clips` / `release-substack-text` skills) and
   `broadbanner-scheduling` (this plugin). Install from the public marketplace —
   no local credentials:

   ```
   /plugin marketplace add BroadBanner/broadbanner-plugins
   /plugin install broadbanner-social-distribution@broadbanner
   /plugin install broadbanner-scheduling@broadbanner
   ```

   Update later with `/plugin marketplace update broadbanner`. (First-time
   machine setup for the CLIs and per-service auth: see
   `Documentation/guides/broadbanner-cli-setup-guide.docx` and the numbered
   per-service guides.)
2. **BroadBanner MCP connector connected** — Cowork → Settings → Connectors → Add
   custom connector → `https://mcp.broadbanner.com/mcp` → sign in via WorkOS with
   **that workspace's creator email**. The connector provides identity, the clip
   list, and the Substack handle; there are no local credentials.
3. **The project is a BroadBanner project** — its root has
   `broadbanner.config.json` (created by `banner-admin init`). Template variables
   in specs (`{{PROJECT_BASENAME}}`, `{{BRAND_SLUG}}`, `{{POD_PREFIX}}`, …) resolve
   from this file.

The browser Cowork drives must be logged into the Substack account the task posts
to (the `substackHandle` the connector resolves for that workspace/brand).

---

## 1. The model (read once)

- **One spec file = one scheduled task.** Specs live **in the project repo** at
  `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/*.md`, versioned with the brand —
  not in this plugin. That is what makes them portable: clone the project on any
  machine and the specs come with it.
- A spec is YAML frontmatter (`id`, `description`, `cronExpression` **or**
  `fireAt`, `enabled`) plus a Markdown body that is the prompt run on each fire.
  See [`skills/install-scheduled-tasks/references/spec-format.md`](skills/install-scheduled-tasks/references/spec-format.md).
- **`banner-admin install-schedules` only writes files; it does not register
  anything.** Registration is the `install-scheduled-tasks` skill calling Cowork's
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
2. Say **"install the scheduled tasks"** to run `install-scheduled-tasks`.
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
| **Change schedule / prompt** | Edit the spec `.md`, commit, re-run `install-scheduled-tasks` from that project. |
| **Pause** | Set `enabled: false` in the spec, re-run the skill (or toggle in the Cowork sidebar). |
| **List** | The skill calls `list_scheduled_tasks`; or view them in the Cowork scheduled-tasks sidebar. |
| **Add a new task** | Drop a new `<name>.md` spec in the project's `.broadbanner/scheduled-tasks/`, re-run the skill. No plugin change. |
| **Remove** | Delete the task in the Cowork sidebar, and delete its spec so a future install doesn't recreate it. |

---

## 4. Worked example — clip release to BOTH the brand account and your personal Substack

**How clip routing works.** `release-substack-clips` is brand-scoped. Each clip
fans out to **every enrolled host's workspace**, so the same clip exists once per
workspace, each copy with its **own** Substack status slot. A task posts *its
workspace's copy* to *one* account and marks only that copy released. So you route
each copy independently — that is how one clip reaches two accounts with no
double-post.

Goal: put `babm-afbc` (Banner & Backbone) clips on **both** `@bannerandbackbone`
(the show account) **and** `@nickparo` (the personal account).

### 4a. BannerAndBackboneMedia project → `@bannerandbackbone`

This workspace's identity owns the `@bannerandbackbone` handle for the `babm`
brand. Scaffold the shipped `release-substack-clips` template here — its
`{{BRAND_SLUG}}` resolves to `babm` from this project's `broadbanner.config.json`,
so it lists only `babm` clips and posts them to `@bannerandbackbone`. Spec file:
`<BannerAndBackboneMedia>/.broadbanner/scheduled-tasks/release-substack-clips.md`.

### 4b. NickParo project → `@nickparo` (brandless cross-post)

`@nickparo` is your **default** handle, reachable only by a **brandless** run (no
`brand:` argument), which also pulls *all* of this identity's pending clips. Add a
custom spec — `<NickParo>/.broadbanner/scheduled-tasks/release-substack-clips-personal.md`:

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

Then, **in each project's Cowork chat**, run `install-scheduled-tasks`. Result:
the BannerAndBackboneMedia copy → `@bannerandbackbone`, the NickParo copy →
`@nickparo`. Same clips, both accounts.

> **Heads-up:** the brandless NickParo task posts *every* clip this identity has
> pending to `@nickparo` (not just `babm`). Since `@nickparo` is your default
> account that is usually intended; if you run a separate per-brand workspace for
> another brand's account, keep that brand's clips out of the brandless lane by
> routing them from their own workspace instead.

### Cadence reference (don't conflate them)

| Task | Cron | Cap |
| --- | --- | --- |
| `release-substack-clips` (video) | `*/30 9-21 * * *` (~30 min, 9am–9pm) | 2 clips/run |
| `release-substack-text` (text) | `*/2 * * * *` (~2 min, 24/7) | — |
