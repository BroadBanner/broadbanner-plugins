# Pause and resume a desk's runs

Used when the member wants a desk's nightly runs to stop for a while without losing
them, most often while **The Room** (the nightly newsroom project) runs the same work:
its setup kit lists the desk tasks to pause, and the phrase to say.

- **Pause** ("pause the nightly runs for the writing desk and the checking desk", "pause
  Bruce's runs"): select the runs exactly as an install would (desk, personas or task ids;
  see "Writing team runs" in SKILL.md). Call `list_scheduled_tasks`, keep only the selected
  ids that are registered, and show the list. One yes covers it. Then call
  `update_scheduled_task { taskId, enabled: false }` for each. Never delete, never change a
  prompt or a schedule.
- **Resume** ("resume the nightly runs for …"): the same selection, then
  `update_scheduled_task { taskId, enabled: true }` for each.
- A selected id that isn't registered here: say "not installed in this project" and leave
  it. It may be filed under the other desk's project; tell the member to say the same
  phrase there.
- **Report** one line per task: paused / resumed / not installed, and how to undo it (the
  opposite phrase).
- Unlike install, a pause or resume may act on a run from either desk when the member
  names it, because it changes only `enabled`.
