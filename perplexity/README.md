# BroadBanner plugins for Perplexity

Perplexity builds of the BroadBanner plugins. Each folder is one plugin with
`plugin.json` at its root. They hold only the skills that work through the
BroadBanner connector alone. The Substack and Restream browser skills stay in
the Claude plugins for now.

## Install

1. **Connect BroadBanner once.** In Perplexity, add a custom remote connector:
   URL `https://mcp.broadbanner.com/mcp`, transport Streamable HTTP, authentication
   OAuth. Sign in with the email you use on app.broadbanner.com. You only see
   the tools your membership includes.
2. **Import a plugin.** On the Plugins page in Perplexity Computer, choose to
   import from GitHub and paste the folder URL below.

### `broadbanner-post-production` (v0.27.1)

Writing and checks for BroadBanner creators (post_production_distribution add-on). Write or revise articles in a brand or series voice, run independent editorial and fact checks, build your private self-profile, and turn a stored transcript into a review draft, all through the BroadBanner connector. Never publishes.

Folder URL: `https://github.com/BroadBanner/broadbanner-plugins/tree/main/perplexity/broadbanner-post-production`

Skills: `article-write`, `editorial-check`, `fact-check`, `self-profile`, `transcript-correction`, `episode-review`, `article-publish`

## Updating

Perplexity doesn't re-sync an imported plugin from GitHub. When a new version
ships, open the plugin, choose **More actions → Replace file**, or remove it and
import the folder again.

## Scheduled runs

The nightly tasks these skills mention (saved news prompts, the nightly fact
and editorial checks) are installed through Claude's scheduler. On Perplexity,
create a scheduled task in Computer with the same prompt instead. Run each
nightly task on one client only, or both will work the same queue.

---

> **Auto-generated** from the private source by `scripts/build-perplexity.mjs`.
> Don't edit this folder directly.
