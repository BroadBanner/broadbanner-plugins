# BroadBanner Episode Review Pipeline Plugin

End-to-end episode processing for **Banner and Backbone Media**. Takes a Substack post URL and orchestrates the full chain from section assignment to published review.

## Skills

| Skill              | Description                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `episode-pipeline` | Orchestrate the 5-step episode processing chain: section select, transcript download, transcript correction, episode review, and Pages publish. |

## How it works

1. Provide a Substack post URL, pod ID, and episode identifier
2. The pipeline loads show metadata and runs each step in sequence
3. You can resume from any step if something needs to be re-run

## Pipeline steps

1. **Section Select** — Assign the post to the correct Substack publication section
2. **Transcript Download** — Download the raw `.txt` transcript from Substack
3. **Transcript Correction** — Deterministic fixes + AI speaker attribution and cleanup
4. **Episode Review** — Generate a publication-ready review from the corrected transcript
5. **Pages Publish** — Format for Jekyll, write to Pages repo, update index, optionally create PR

## Requirements

- Claude in Chrome extension (for Steps 1 and 2)
- The host `~/BroadBanner` directory mounted (for runtime directories: Pages, Social-Distribution)

## Self-contained resources

This plugin ships the sub-skill logic; per-show data lives in the user's workspace:

- **Show metadata** — `<workspace-root>/broadbanner.config.json` under the `shows[<pod-id>]` field (workspace root is the directory containing `broadbanner.config.json` — walk up from CWD if needed)
- **Pod-id → brand/podcast mapping** — `<workspace-root>/pod-map.json`
- **Onboarding** — run `banner-admin brand-watch --init <podcast-name>` to scaffold a YAML payload, then have `banner-admin brand-watch` write it into `broadbanner.config.json.shows[<pod-id>]`
- **Sub-skill instructions** — `skills/section-select/`, `skills/transcript-download/`, `skills/transcript-correction/`, `skills/episode-review/`, `skills/pages-publish/` (each with SKILL.md and references)

## For the production team

This plugin is installed via Cowork. Updates publish automatically when changes are pushed to `main`. To process an episode, just say "run the pipeline" and provide the Substack URL and pod ID.
