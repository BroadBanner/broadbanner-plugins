---
name: transcript-download
description: "Download a podcast transcript from Substack and save it to Social-Distribution/transcripts/ with correct naming and placement. Use when the user mentions downloading a transcript, fetching a transcript from Substack, getting the .txt file for an episode, or preparing a transcript for the episode pipeline. Also triggers when the user provides a Substack URL for transcript extraction, or says 'new episode dropped' or 'process this episode'. Handles browser automation to download the .txt, renaming to conventions, and saving to the correct brand/podcast/season directory."
---

# Transcript Download

Download a Substack video/podcast transcript via browser automation and save it to the correct location in `Social-Distribution/transcripts/`.

This skill replaces the API-based `transcript-fetch` CLI tool. Instead of trying to hit Substack's API endpoints (which require fragile session cookies and often fail on drafts), it automates the same four clicks a human would make in the Substack editor.

## When to use this skill

- A new episode has been recorded and uploaded to Substack
- The user provides a Substack post URL (draft or published) and wants the transcript
- The user says they need to "download," "fetch," or "grab" a transcript
- As the first step before running transcript correction or episode review generation

## What this skill does NOT do

This skill only handles transcript acquisition and file placement. It does not correct the transcript, generate a review, or write to the Pages repo. Those are separate pipeline steps that should be handled by their own skills.

## Prerequisites

- Claude in Chrome must be enabled and connected
- The user must be logged into Substack in their browser (the post editor requires auth)
- The BroadBanner ecosystem must be accessible (`Social-Distribution/transcripts/`, pod-map.json)

## Inputs

Gather these from the user before starting. Use `<workspace-root>/pod-map.json` (the workspace root is the directory containing `broadbanner.config.json` — walk up from CWD if needed) to validate the pod-id and resolve brand/podcast paths.

| Input                 | Required    | Example                                              | Notes                                                                                                                          |
| --------------------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Substack URL          | Yes         | `https://sickofthis.substack.com/publish/post/12345` | Draft or published post URL                                                                                                    |
| Pod ID                | Yes         | `sotsp-im`                                           | Must match an entry in `<workspace-root>/pod-map.json`                                                                      |
| Episode number        | Conditional | `25`                                                 | Integer. Required for season-based and book-based shows; **not used** for episodic shows.                                      |
| Season or Book number | Conditional | `--season 1` or `--book 4`                           | Mutually exclusive. Required (or defaults to season 1) for season-based and book-based shows; **not used** for episodic shows. |
| Short title           | Conditional | `forrest-page`                                       | Kebab-case; derived from post title if omitted. **Required** for episodic shows — it becomes the filename slug.                |

If the user doesn't provide all inputs upfront, ask for the missing ones. The Substack URL and pod-id are non-negotiable.

Required inputs depend on `broadbanner.config.json.shows[<pod-id>].seasonBookMode`:

- **`season` mode** — episode number required; season defaults to 1 if neither season nor book is specified.
- **`book` mode** — episode number and book number both required.
- **`episodic` mode** — neither episode number nor season/book number is used; only the short title (slug) is needed for the filename.

## Step-by-step workflow

### Step 1: Validate inputs and resolve paths

1. Look up the pod-id in `<workspace-root>/pod-map.json` to get the `brand` and `podcast` directory names plus the Substack domain.
2. Read the filename prefix from `<workspace-root>/broadbanner.config.json` under `shows[<pod-id>].seriesId` (an uppercase 2-5 char abbreviation, e.g. `IM`, `AFBC`, `NOTW`, `PALAN`, `DC`, `CIO`, `FR`, `EW`, `TFL`).
3. Read `broadbanner.config.json.shows[<pod-id>].seasonBookMode` and build the destination path accordingly:
   - Season-based (`seasonBookMode = "season"`): `Social-Distribution/transcripts/<brand>/<podcast>/season-<NN>/<PREFIX>_s<S>e<EE>_<short-title>.txt`
   - Book-based (`seasonBookMode = "book"`): `Social-Distribution/transcripts/<brand>/<podcast>/book-<NN>/<PREFIX>_book<B>-e<E>_<short-title>.txt`
   - Episodic (`seasonBookMode = "episodic"`): `Social-Distribution/transcripts/<brand>/<podcast>/episodes/<PREFIX>_<short-title>.txt`
   - Zero-pad season/book to 2 digits (e.g., `season-01`, `book-04`)
   - Zero-pad episode to 2 digits in the filename (e.g., `e01`, `e25`)
   - For episodic mode there is no season/book directory and no `s<S>e<EE>` or `book<B>-e<E>` segment — the short title is the filename slug
4. Confirm the destination path with the user before proceeding

### Step 1.5: Select the correct Chrome profile

Before navigating, switch to the Claude-in-Chrome profile that owns the Substack publication for this episode's pod. See `../../references/chrome-profile-routing.md` for the full algorithm.

1. Load `broadbanner.config.json` from the brand workspace root and read `chromeProfiles`.
2. Look up `chromeProfiles.bySeriesId[pod_id]` first.
3. Else `chromeProfiles.byBrand[brand]` (the `brand` was resolved in Step 1 from the pod-map).
4. Else: skip the switch.

If a target deviceId resolved:

```
list_connected_browsers → confirm <resolved deviceId> is in the connected list (ignore the `name` field — it's a volatile ordinal)
select_browser({ deviceId: <resolved deviceId> })
```

Skip if already selected. If the resolved deviceId is not in the connected list, **stop and tell the user** — the transcript download must come from the publication that owns the post.

### Step 2: Navigate to the Substack post

1. Open the Substack URL in Chrome using `navigate`
2. Wait for the page to load
3. Take a screenshot to verify you're on the correct page (the Substack post editor)

If the page shows a login screen, stop and tell the user they need to log into Substack first.

### Step 3: Open Media Settings

1. Find the scissors icon (video/media editing icon) in the editor toolbar area. It's typically in the top area of the post editor, near the video player controls
2. Click the scissors icon
3. Wait for the "Media settings" panel to appear on the right side of the screen
4. Take a screenshot to confirm the panel is open

### Step 4: Navigate to the Transcript tab

1. In the "Media settings" panel, find the tab bar with "Settings", "Transcript", and "Clips"
2. Click the "Transcript" tab
3. Wait for the transcript content to load (you should see timestamped speaker segments)
4. Take a screenshot to confirm you're on the Transcript tab

### Step 5: Open the overflow menu and download

1. Find the "..." (three dots / overflow) menu button in the Transcript section. It's in the toolbar row that contains "Regenerate", "Upload transcript", and the "..." button
2. Click the "..." button
3. Wait for the dropdown menu to appear with options: "Correct transcript", "Download .txt", "Download .json", "Remove"
4. Click "Download .txt"
5. Wait a moment for the download to complete

### Step 6: Locate and rename the downloaded file

1. Check the user's Downloads folder for the most recently downloaded `.txt` file
2. Read the file to verify it contains transcript content (timestamped speaker text)
3. If a short-title wasn't provided, try to derive one from the post title visible on the page:
   - For titles like "Series Name | E9 - Short Title", take the part after the dash
   - Convert to kebab-case (lowercase, hyphens instead of spaces, strip punctuation)
   - Keep the first 6 meaningful words maximum
4. Rename the file to match the naming convention determined in Step 1
5. Create the destination directory if it doesn't exist
6. Move the file to the correct location under `Social-Distribution/transcripts/`

### Step 7: Verify and report

1. Read the first few lines of the saved file to confirm it's valid transcript content
2. Report to the user:
   - The full path where the transcript was saved
   - The episode slug (filename without .txt extension) — this is what downstream skills will use
   - File size / character count
3. Suggest the next step: "The transcript is ready. You can now run transcript correction on it."

## Error handling

- **Scissors icon not found**: The video may not have been uploaded yet, or the page layout has changed. Take a screenshot and ask the user for guidance.
- **Transcript tab shows "no transcript"**: The auto-transcription may not be complete yet. Tell the user to wait and try again, or to use the "Regenerate" button.
- **Download doesn't start**: Try clicking "Download .txt" again. If it still fails, ask the user to download manually and provide the file path.
- **Wrong page / login required**: Stop immediately, explain the issue, and ask the user to navigate to the correct page or log in.

## URL structure reference

Substack URLs follow two patterns:

- **Draft posts**: `https://<subdomain>.substack.com/publish/post/<numeric-id>`
- **Published posts**: `https://<subdomain>.substack.com/p/<slug>`

The subdomain maps to a brand via the url-map:

- `sickofthis.substack.com` -> `sick-of-this-shit-publications`
- `bannerandbackbone.substack.com` -> `banner-and-backbone-media`
- `firebrandproject.substack.com` -> `firebrand-project`
- `thiswomanvotes.substack.com` -> `this-woman-votes`
