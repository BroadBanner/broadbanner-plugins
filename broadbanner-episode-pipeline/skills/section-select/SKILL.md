---
name: section-select
description: "Select the correct Substack section for a podcast episode before publishing. Use this skill when a Substack post needs to be assigned to a specific section (series/podcast) on a multi-section publication. Triggers when the user mentions selecting a section, assigning a section, or when the Substack editor is open and the post needs a section before transcript download. This is the first step in the episode pipeline for multi-section publications."
---

# Section Select

Assign a Substack post to the correct publication section based on the podcast's pod-id. This ensures the post is filed under the right series before any downstream pipeline steps (transcript download, correction, review, publish).

## Why this skill exists

Substack publications that host multiple podcasts or series use "sections" to organize content. When a new episode post is created (usually auto-generated from a live video recording), it lands in the publication root with no section assigned. The section must be selected manually in the Substack editor before the post is finalized.

This skill automates that selection by reading the podcast name from show metadata and clicking the matching section in the Substack editor's dropdown.

## When to use this skill

- A new Substack post needs to be assigned to a section before processing
- The user says "select the section," "assign the section," "file this under [show name]," or "set the section"
- As the **first step** in the episode pipeline — before `transcript-download`
- When the Substack editor is open and the "Choose a section" dropdown is visible

## When to skip this skill

- **Single-section publications** (e.g., Firebrand Project, This Woman Votes) — they have no section dropdown
- **Section already correct** — if the button already shows the correct section name, report it and move on
- The post is not on Substack or the editor is not open

## Inputs

| Input             | Required | Example                                                  | Notes                                               |
| ----------------- | -------- | -------------------------------------------------------- | --------------------------------------------------- |
| Substack post URL | Yes      | `https://sickofthis.substack.com/publish/post/192891809` | The editor URL for the post                         |
| Pod ID            | Yes      | `sotsp-tfl`                                              | Used to look up the podcast name from show metadata |

If the user provides a URL, the pod-id can often be inferred from the subdomain using `<workspace-root>/pod-map.json` (the workspace root is the directory containing `broadbanner.config.json` — walk up from CWD if needed). However, publications with multiple shows on the same subdomain (like `sickofthis.substack.com`) require an explicit pod-id to determine which section to select.

## Step-by-step workflow

### Step 1: Load show metadata

Resolve the workspace root (the directory containing `broadbanner.config.json` — walk up from CWD if needed) and read:

```
<workspace-root>/broadbanner.config.json
```

Look up `shows[<pod-id>].displayName` — this is the human-readable name that matches the Substack section name in the dropdown exactly.

**If `shows[<pod-id>].displayName` is absent:** ask the user which section to select. Do not invent a name.

### Step 1.5: Select the correct Chrome profile

Before navigating, switch to the Claude-in-Chrome profile that owns the Substack publication for this pod. See `../../references/chrome-profile-routing.md` for the full algorithm.

1. Load `broadbanner.config.json` from the brand workspace root and read `chromeProfiles`.
2. Look up `chromeProfiles.bySeriesId[pod_id]` first.
3. Else `chromeProfiles.byBrand[brand]` (resolve `brand` via `<workspace-root>/pod-map.json` for this pod-id).
4. Else: skip the switch.

If a target profile resolved:

```
list_connected_browsers → find entry where name === <target profile>
select_browser({ deviceId: <matching deviceId> })
```

Skip if already selected. If no connected browser matches, **stop and tell the user** — the section selector lives inside the Substack publication, so the wrong profile won't see the right section list.

### Step 2: Navigate to the Substack editor

If the browser is not already on the Substack editor page, navigate to the provided URL.

Confirm the page has loaded by checking for the presence of the section selector button (the "Choose a section" dropdown in the editor toolbar).

### Step 3: Check current section state

Look at the section selector button text:

- **If it reads "Choose a section"** → no section is assigned yet. Proceed to Step 4.
- **If it already shows the correct podcast name** → report "Section already set to [name]. No action needed." and stop.
- **If it shows a different section name** → proceed to Step 4 to change it. Report what it was previously set to.

### Step 4: Open the section dropdown

Click the "Choose a section" button (or the currently-assigned section button) in the editor toolbar. This opens a dropdown menu with all available sections as `menuitem` elements.

Wait for the dropdown to appear. The dropdown contains:

- The publication name (brand-level section, always first)
- Individual series/podcast sections

### Step 5: Select the matching section

Find the `menuitem` in the dropdown whose text matches the `displayName` from `broadbanner.config.json.shows[<pod-id>]`. The match should be **case-insensitive** but will usually be exact.

Click the matching menuitem.

**If no match is found:** list all available section names from the dropdown and report:

```
No section matching "[displayName]" found in the dropdown.
Available sections: [list]
The displayName in broadbanner.config.json may not match the Substack section text exactly.
Ask the user which section to select.
```

### Step 6: Confirm selection

After clicking, verify the section selector button now shows the selected section name (no longer "Choose a section").

Take a screenshot for the user to confirm.

### Step 7: Report

Present:

- The section that was selected
- The pod-id and displayName used for the match
- Whether the section was newly assigned or changed from a previous value
- Suggested next step: "Section set. You can now proceed with transcript download."

## Error handling

- **Substack editor not loaded:** If the page doesn't show the section selector after navigation, the user may not be logged in. Report: "The Substack editor didn't load. Make sure you're logged into Substack in this browser."
- **No section dropdown on page:** Some publications don't use sections. Report: "No section selector found. This publication may not use sections — you can skip this step."
- **Section name mismatch:** If `shows[<pod-id>].displayName` doesn't match any dropdown option, list available options and ask the user. The fix is to update `displayName` in `broadbanner.config.json` to match Substack exactly.
- **Multiple close matches:** If fuzzy matching finds more than one candidate, list all and ask the user to confirm.

## Extending the system

**New show on existing publication:** Onboard the show via `banner-admin brand-watch --init <podcast-name>` (writes a YAML payload template to CWD), then run `banner-admin brand-watch` to write the result to `<workspace-root>/broadbanner.config.json` under `shows[<pod-id>]`. Make sure `displayName` matches the Substack section name exactly. No changes to this skill required.

**New publication with sections:** No changes needed — the skill reads section names dynamically from the Substack dropdown, not from a hardcoded list.
