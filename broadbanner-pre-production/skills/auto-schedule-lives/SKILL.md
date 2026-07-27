---
name: auto-schedule-lives
description: "Set up UNATTENDED auto-scheduling of your live shows on Substack and Restream — the Pre-Production Assistant add-on. Use when the user says 'auto-schedule my lives', 'automate the live scheduling', 'set up pre-production auto-scheduling', or 'schedule my shows automatically every day'. Installs recurring scheduled tasks that run the schedule-live skills on a cron (no manual run each time), via the broadbanner-scheduled-tasks engine. Production+ add-on (pre_production_assistant)."
metadata:
  requiresTool: pre_production_assistant
---

# Auto-Schedule Lives (Pre-Production Assistant)

Set up the **unattended automation** of live scheduling: recurring scheduled tasks
that run `substack-schedule-live` and `restream-schedule-live` on a daily cron so your
upcoming shows get scheduled on Substack and Restream **without you running anything by
hand**. This is the **Pre-Production Assistant** add-on (Production+ / entitlement
`pre_production_assistant`, cap `scheduling:auto`).

This skill is a thin gated front door: it confirms the entitlement, then hands off to
the **`broadbanner-scheduled-tasks`** engine (its `manage` skill) to scaffold and
register the two auto-scheduling tasks. The manual scheduling skills themselves
(`substack-schedule-live` / `restream-schedule-live`, in `broadbanner-live-production`,
Creator+) are unchanged — this add-on just runs them on a schedule.

## Step 0 — Entitlement preflight (advisory)

This skill is declared `metadata.requiresTool: pre_production_assistant`. Before any
work, call `get_creator_context` and, if it returns a capability summary
(`entitledTools` / `caps` / `tier`), confirm `pre_production_assistant` ∈
`entitledTools` (or the `scheduling:auto` cap ∈ `caps`). If those fields are present
and the entitlement is absent, stop with the CTA below. If the context omits them
(older connector), proceed — the server-side gate remains the backstop.

> ⚠️ Auto-scheduling is the **Production+** Pre-Production Assistant add-on
> (`pre_production_assistant`, $5/mo). Your account isn't entitled yet — add it from
> your member portal → https://app.broadbanner.com/pricing/membership. Nothing was scheduled.

## ⚠️ Local machine only — cannot run in the cloud

The scheduled tasks this installs drive **local Chrome** (Substack/Restream have no
API). They **cannot run on a cloud/headless agent**. Two requirements: (1) install and
run from **desktop Cowork on the machine** where the single BroadBanner Chrome profile
stays logged in; (2) set **Cowork Home to run on your computer** (not the beta "run in
cloud" mode) so the tasks file as **"Runs on this computer."** See the
`broadbanner-scheduled-tasks` `manage` skill for the full run-location detail.

## Prerequisites

- The **BroadBanner MCP connector** connected (`https://mcp.broadbanner.com/mcp`), on a
  session authorized to schedule (brand-admin/super-admin today; host-of-series once
  creator-scoped scheduling ships). Connector-only — no config, no gateway token.
- The **`broadbanner-scheduled-tasks`** plugin installed (this skill delegates to its
  `manage` skill). If it isn't installed, tell the user to add it from the marketplace.
- The single connected BroadBanner Chrome profile logged into Substack (and Restream
  Studio, for the restream task).

## Step 1 — Install the auto-scheduling tasks (delegate to the engine)

This plugin ships the two auto-scheduling task templates in its own
`references/templates/` directory (`schedule-substack-live.md`,
`schedule-restream-live.md`). Install them through the shared engine so all the
spec-resolution, cadence, `--refresh`, and prompt-regression-guard logic is reused —
do **not** reimplement it here.

1. Resolve this plugin's templates directory: it is `references/templates/` at this
   plugin's root — i.e. `../../references/templates` relative to this skill's directory.
   Capture its absolute path as `PP_TEMPLATES`.
2. Invoke the **`manage`** skill (plugin `broadbanner-scheduled-tasks`) with the
   **`install`** action, telling it to scaffold from `PP_TEMPLATES`: it runs its
   collector as
   `node <manage>/scripts/collect-tasks.mjs --project <PROJECT> --templates-dir "$PP_TEMPLATES" --substack-username <handle> --scaffold` (plus `--brand-slug <slug>` only for
   a single-brand workspace's brand-isolation filter), then proceeds through its normal
   diff → create/update → verify-run-location → report flow.
   - Pass a cadence if the user asked (`--cadence high|medium|low`, default medium).
   - The manage skill's regression guard still applies (it won't overwrite a live task's
     prompt without explicit confirmation).

If you prefer, you can just tell the user to run `manage install` themselves after
scaffolding these templates — but the point of this skill is to gate on the add-on and
drive that install for them.

## Step 2 — Confirm + report

After the engine finishes, confirm both tasks (`schedule-substack-live-*`,
`schedule-restream-live-*`) are registered and show **"Runs on this computer."** Report
the two task ids, their cron, and run location. Remind the user to click **Run now**
once on each to capture browser/connector approvals.

To later change cadence, re-run this skill (or `manage update`); to remove, use
`manage uninstall`.

## See also

- `broadbanner-scheduled-tasks` → `manage` skill — the engine that installs/updates/
  uninstalls scheduled tasks (the mechanics, run-location, regression guard).
- `broadbanner-live-production` → `substack-schedule-live` / `restream-schedule-live` —
  the manual (Creator+) scheduling skills these tasks automate.
