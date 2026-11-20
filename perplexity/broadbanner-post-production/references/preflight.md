# Entitlement preflight (shared by this plugin's skills)

Efficiency plan D2: one copy of the preflight instead of one per skill, and **no tool
call** for it.

The BroadBanner connector registers the articles tools (`writing_session`,
`get_writing_context`, `create_article`, `article_check_pack`, …) **only** for an account
that holds the Production+ add-on (`post_production_distribution`) or is an admin. So:

- **The tool this step needs is in the connector:** the account is entitled. Carry on.
  Do not call `get_creator_context` or `whoami` to check again.
- **It is missing:** stop before any browser work or drafting with the skill's own line:

  > ⚠️ {What this skill does} is part of the **Production+** add-on
  > (`post_production_distribution`). Add it from
  > https://app.broadbanner.com/pricing/membership. Nothing was {written | checked |
  > reviewed | published}.

  If `whoami` is available and the user wants to know why, one `whoami` call explains
  which tool groups the account has.
- **A tool call fails with 403 / `addon_required` / `forbidden`:** same message; the
  server's cap check is the backstop.

When the `post-production` orchestrator calls a step skill, the preflight has already
run: don't repeat it.
