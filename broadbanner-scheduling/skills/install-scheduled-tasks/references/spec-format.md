# Scheduled-task spec format

A spec is one Markdown file in a project's
`<PROJECT_ROOT>/.broadbanner/scheduled-tasks/` directory. One file = one
scheduled task. Filename (minus `.md`) is the default task id.

## Frontmatter

```yaml
---
id: schedule-substack-live-levremembers   # optional; default = filename, slugified
description: One-line summary shown in the sidebar.   # required
cronExpression: 10 3 * * *                # recurring (LOCAL time, 5-field cron)
# fireAt: 2026-07-01T09:00:00-04:00       # OR one-time (ISO 8601 w/ offset)
enabled: true                             # optional; default true
---
```

Rules:

- Provide **`cronExpression`** (recurring) **or** `fireAt` (one-time) **or
  neither** (ad-hoc — only runnable manually). If both are present,
  `cronExpression` wins and a warning is emitted.
- `cronExpression` is evaluated in the user's **local timezone**, 5-field
  (`minute hour day-of-month month day-of-week`).
- `id` is slugified to `[a-z0-9-]`. It is the scheduler storage key — keep it
  stable across runs so updates are idempotent.
- `enabled: false` registers the task but leaves it paused.

## Body

Everything after the frontmatter is the **prompt** executed on each run. It must
be fully self-contained — a scheduled run has no memory of the session that
installed it. Include which skill/connectors to use, the workspace pin, any
brand scoping, and success criteria.

## Template variables

Bodies and frontmatter may contain `{{VARS}}`, resolved per-project from
`broadbanner.config.json` at collect time. This is what makes one spec portable
across brands.

| Variable | Source | Example (LevRemembers) |
|---|---|---|
| `{{PROJECT_BASENAME}}` | basename of project root | `LevRemembers` |
| `{{PROJECT_ROOT}}` | `~/<basename>` | `~/LevRemembers` |
| `{{CREDS_DIR}}` | `~/.broadbanner/<basename>` | `~/.broadbanner/LevRemembers` |
| `{{BRAND_SLUG}}` | `user.brandSlugs[0]` ?? `brands[0].id` | `lr` |
| `{{BRAND_ID}}` | `brands[0].id` | `lr` |
| `{{BRAND_DISPLAY}}` | `brands[0].displayName` | `Lev Remembers` |
| `{{POD_PREFIX}}` | `{{BRAND_SLUG}}` + `-` | `lr-` |
| `{{POD_IDS}}` | `user.effectivePodIds` joined | `lr-lr, lr-vfu, lr-ctwld` |
| `{{CHROME_PROFILE}}` | `chromeProfiles.byBrand[slug]` ?? display | `Lev Remembers` |
| `{{SUBSTACK_USERNAME}}` | `user.substackUsername` | `levparnas` |
| `{{TEXT_RELEASE_CRON}}` | cadence preset (text) | `*/30 * * * *` |
| `{{CLIP_RELEASE_CRON}}` | cadence preset (clips) | `0 8-22 * * *` |

Unknown `{{VARS}}` are left untouched and reported as warnings.

### Release cadence

`{{TEXT_RELEASE_CRON}}` / `{{CLIP_RELEASE_CRON}}` let the release-substack pair
pick a schedule from a **named preset** instead of a hard-coded cron, so a
low-frequency creator isn't stuck on the heavy default. Choose one of
`high | medium | low` (default `medium`) at collect time:

```bash
node collect-tasks.mjs --project ~/X --cadence low
```

| Preset | `{{TEXT_RELEASE_CRON}}` | `{{CLIP_RELEASE_CRON}}` |
|---|---|---|
| `high` | `*/2 * * * *` (24/7, minimal lag) | `*/15 8-22 * * *` |
| `medium` (default) | `*/30 * * * *` | `0 8-22 * * *` (hourly 8am–10pm) |
| `low` | `0 9-21 * * *` | `0 10,14,18 * * *` |

Resolution order: a raw override (`--text-cron` / `--clip-cron`, or
`scheduling.textCron` / `scheduling.clipCron` in config) > the named preset
(`--cadence`, or `scheduling.cadence` in config) > `medium`. A literal cron typed
directly into a scaffolded spec's `cronExpression` also wins — it isn't a `{{VAR}}`
so the collector leaves it untouched. Config form:

```json
{ "scheduling": { "cadence": "low" } }
```

## Normalized output

`collect-tasks.mjs` emits:

```json
{
  "projectRoot": "/Users/.../LevRemembers",
  "projectBasename": "LevRemembers",
  "specDir": ".broadbanner/scheduled-tasks",
  "scaffolded": [],
  "vars": { "...": "..." },
  "tasks": [
    {
      "id": "schedule-substack-live-levremembers",
      "description": "...",
      "cronExpression": "10 3 * * *",
      "enabled": true,
      "prompt": "...resolved body...",
      "sourceFile": ".broadbanner/scheduled-tasks/schedule-substack-live.md"
    }
  ],
  "warnings": []
}
```
