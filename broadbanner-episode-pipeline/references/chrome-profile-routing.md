# Chrome Profile Routing

Some pods belong to shared/co-owned Substack and Restream accounts that live in a separate Chrome profile from the brand's primary profile. Browser-driving skills must select the correct Claude-in-Chrome browser profile **before** any browser action, otherwise the automation will hit the wrong account.

## Source of truth

`broadbanner.config.json` (in the brand workspace root) carries a `chromeProfiles` block:

```json
"chromeProfiles": {
  "bySeriesId": {
    "sotsp-tfl": "Shared SOTSP"
  },
  "byBrand": {
    "sick-of-this-shit-publications": "Sick of this Shit Publications",
    "banner-and-backbone-media": "Banner and Backbone Media"
  }
}
```

## Resolution algorithm

For each show or clip you're about to act on:

1. If `chromeProfiles.bySeriesId[show.seriesId]` (or `clip.pod_id`) is set → use that profile name.
2. Else if `chromeProfiles.byBrand[show.brand]` is set → use that profile name.
3. Else → make no change; keep whatever browser is currently selected.

If the resolved profile name is the **same** as the currently-selected browser, skip the switch — `select_browser` is idempotent but the round-trip wastes time.

## How to switch

```
mcp__Claude_in_Chrome__list_connected_browsers
→ returns array of { deviceId, name, ... }
```

Find the entry whose `name` matches the resolved profile name (case-sensitive exact match). Then:

```
mcp__Claude_in_Chrome__select_browser({ deviceId: <matching deviceId> })
```

If no connected browser matches the resolved profile name, **stop and tell the user**. Do not fall back silently — running the automation on the wrong account can post or schedule under the wrong identity. Suggest the user pair the missing profile via `switch_browser` (the user will get a "Connect" prompt in the right Chrome profile and can name it).

## When to re-resolve

Re-resolve and re-switch **before each show** when iterating multiple shows in one run. Different shows may map to different profiles (e.g., a batch of shows includes both `sotsp-tfl` and `sotsp-cio`). Group shows by resolved profile to minimize switches if processing is order-independent.

## When to skip

- The skill has no seriesId/brand context (e.g., manual single-clip publish where pod isn't known) → use whatever browser is selected and note the assumption in the user-facing report.
- `chromeProfiles` block is absent from the config → use whatever browser is selected (legacy behavior).
- The current browser already matches the resolved name → no switch.
