# Chrome Profile Routing

Some pods belong to shared/co-owned Substack and Restream accounts that live in a separate Chrome profile from the brand's primary profile. Browser-driving skills must select the correct Claude-in-Chrome browser profile **before** any browser action, otherwise the automation will hit the wrong account.

## Source of truth

`broadbanner.config.json` (in the brand workspace root) carries a `chromeProfiles` block. **Routing values are stable Claude-in-Chrome `deviceId`s — not display names.**

```json
"chromeProfiles": {
  "_deviceLabels": {
    "16e73433-2637-4119-a919-a8f27f3f2644": "Shared SOTSP",
    "29945170-9e83-45c0-a920-75da56721c91": "Banner and Backbone Media"
  },
  "bySeriesId": {
    "sotsp-tfl": "16e73433-2637-4119-a919-a8f27f3f2644"
  },
  "byBrand": {
    "sick-of-this-shit-publications": "16e73433-2637-4119-a919-a8f27f3f2644",
    "banner-and-backbone-media": "29945170-9e83-45c0-a920-75da56721c91"
  },
  "default": "cc9a0d01-a070-44d4-b507-af12dd9d3dd9"
}
```

> **Why `deviceId`, not name?** `list_connected_browsers` does **not** surface the custom name you typed when pairing a browser. It returns a **positional, recency-ranked label** (`Browser 1`, `Browser 2`, …) that reshuffles whenever any browser reconnects. Matching on that `name` never reliably hits the intended profile — it silently selects the wrong one. The `deviceId` is stable per Chrome profile, so it is the only dependable routing key. `_deviceLabels` maps each deviceId to a human-readable profile name for maintenance only; **skills never match against it**.

`bySeriesId` and `byPodId` are accepted as aliases for the per-series map —
older specs use `bySeriesId`, newer ones `byPodId`; both key on the same
`clip.pod_id` / `show.seriesId` value.

The `default` key (added for **multi-brand contributor hubs**) is the
catch-all **deviceId** used when neither the per-series nor the per-brand map
matches. A contributor who hosts shows across several brands but posts them all
to **one** personal account only needs `"default": "<that profile's deviceId>"` — no need
to enumerate every brand. Per-series / per-brand entries still win over it, so a
hub that splits a few shows to other accounts can override case-by-case.

## Resolution algorithm

For each show or clip you're about to act on:

1. If `chromeProfiles.bySeriesId[…]` / `chromeProfiles.byPodId[…]` (keyed by `show.seriesId` / `clip.pod_id`) is set → use that **deviceId**.
2. Else if `chromeProfiles.byBrand[show.brand]` is set → use that **deviceId**.
3. Else if `chromeProfiles.default` is set → use that **deviceId**.
4. Else → make no change; keep whatever browser is currently selected.

If the resolved deviceId is the **same** as the currently-selected browser, skip the switch — `select_browser` is idempotent but the round-trip wastes time.

## How to switch

```
mcp__Claude_in_Chrome__list_connected_browsers
→ returns array of { deviceId, name, ... }   // the `name` field is a volatile ordinal — IGNORE it
```

Confirm the resolved **deviceId** is present in the connected list (that profile is connected). Then:

```
mcp__Claude_in_Chrome__select_browser({ deviceId: <resolved deviceId> })
```

Do **not** match on the `name` field — it is a recency-ranked "Browser N" label, not the profile you paired. If the resolved deviceId is **not** in the connected list, **stop and tell the user**. Do not fall back silently — running the automation on the wrong account can post or schedule under the wrong identity. Ask the user to open/connect the Chrome profile named for that deviceId in `_deviceLabels`.

> **If a deviceId ever goes stale** (a Chrome profile was re-provisioned and got a new deviceId), re-map it: for each connected browser, `select_browser` it and read the signed-in Restream/Substack account, then update the `chromeProfiles` deviceId values and `_deviceLabels` in the config to match.

## When to re-resolve

Re-resolve and re-switch **before each show** when iterating multiple shows in one run. Different shows may map to different profiles (e.g., a batch of shows includes both `sotsp-tfl` and `sotsp-cio`). Group shows by resolved deviceId to minimize switches if processing is order-independent.

## When to skip

- The skill has no seriesId/brand context (e.g., manual single-clip publish where pod isn't known) → use whatever browser is selected and note the assumption in the user-facing report.
- `chromeProfiles` block is absent from the config → use whatever browser is selected (legacy behavior).
- The current browser already matches the resolved deviceId → no switch.
