# Substack schedule-live — Re-titling (planned)

Loaded on demand from `SKILL.md`. Moved verbatim from the skill body (efficiency plan D1): the rules are unchanged. Paths below are relative to the skill folder (where SKILL.md is), as in the skill itself.

## Re-titling a scheduled live after a title change (PLANNED — not yet automated)

> **Status: documented, not implemented.** No code path below is wired yet — this
> section records the intended flow so it's ready to build. Do not attempt to
> auto-run it.

When a show's title changes in BroadBanner **after** its Substack live was already
scheduled, the scheduled live keeps the **old** title. The analogous fix to the Restream
skill's "Re-titling a scheduled show" flow would be:

1. Detect the drift the same way — the show's current `showTitle` differs from the title
   captured when the live was scheduled (surface it, or act when the user asks).
2. Re-open the show's already-scheduled Substack live (the "Go live with stream key"
   surface / scheduled-event editor for that `substackLiveUrl`).
3. Update **only** the title (and description) to the current `showTitle` / `showSummary`,
   without regenerating the stream key or touching the schedule / co-host invites.
4. Leave D1 state alone — the title lives in BroadBanner; nothing Substack-side needs a
   writeback for a title-only edit.

Until this is built, a title change after Substack scheduling must be fixed by hand in
the Substack UI.
