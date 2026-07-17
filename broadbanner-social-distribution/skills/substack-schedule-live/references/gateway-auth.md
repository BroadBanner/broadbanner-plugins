# Admin scheduling tools (MCP connector) — reference

This skill reads and writes the BroadBanner system of record **only through the
BroadBanner MCP connector** (server `broadbanner`). There is no capability
token, no `.creds/gateway.token` file, no config, no workspace mount, and no
request signing. The creator authorizes the connector once via OAuth; the
connector's admin tools proxy to the data plane (Gateway → Data Worker)
server-side and stamp the change_log actor for you.

The tools **fail closed**: a connector session without a **brand-admin** or
**super-admin** role gets an authorization error. Those roles are what the old
admin-tier cap-token (`shows:read` + `shows:write`) used to encode — now it's
carried by the creator's connector session, not a file in the workspace.

## Tools

| Tool                     | Args                                                                                     | Returns                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `list_schedulable_shows` | none                                                                                     | `{ generatedAt, shows: [...], _fetch: { cfCacheStatus, age, cfRay } }` — the `GET /v1/shows` envelope verbatim, served fresh each call (Data-Worker KV + CF edge cache bypassed server-side). |
| `set_show_schedule`      | `{ showId, schedule_state?, substack_livestream_url?, restream_stream_key? }` (any subset) | `{ ok, changed }`                                                  |
| `set_show_cohost_invite` | `{ showId, contributorId, junction: "hosts"\|"guests", cohostInviteUrl: string\|null }`  | `{ ok, changed }`                                                  |

`changed: false` is success — the row already matched what you sent.

### `list_schedulable_shows`

Replaces the old `curl .../shows?fresh=1&_cb=...` snapshot read plus its
temp-file/header-dump machinery. Each call is authoritative (no local file to go
stale). The per-show schema is unchanged: `hasLiveScheduled` (wire name for the
D1 `schedule_state` column), `restreamKey`, `substackLivestreamUrl`, nested
`hosts[]`/`guests[]`/`primaryHost`. Use `_fetch.cfCacheStatus` / `_fetch.age` /
`_fetch.cfRay` for the freshness-gate abort diagnostic (see SKILL.md Step 0).

### `set_show_schedule`

Replaces `PATCH /v1/shows/:id`. Partial update — omitted fields are left alone.
Fields (snake_case):

| Field                       | Type             | Notes                                              |
| --------------------------- | ---------------- | -------------------------------------------------- |
| `schedule_state`            | enum             | `"unscheduled" \| "title_customized" \| "substack_scheduling" \| "substack_scheduled" \| "live" \| "completed"` (verbose vocabulary since migration 0016) |
| `substack_livestream_url`   | string \| null   | Public Substack live URL (renamed from `livestream_link` in 0016) |
| `restream_stream_key`       | string \| null   | Stream key captured from Substack                  |

The pre-0016 columns `substack_live_url` / `livestream_link` are retired —
senders MUST use `substack_livestream_url`. A bad field name returns an
`invalid_field`-class error.

### `set_show_cohost_invite`

Replaces `PATCH /v1/shows/:id/{hosts,guests}/:contributor_id`. Sets a single
field, `cohost_invite_url`. Pass `cohostInviteUrl: null` to clear it (the
`accepted` case) or a string to set it (the `pending` case). To preserve a prior
value, simply do not call the tool for that cohost.

## Actor / publication — set automatically

The tools stamp the change_log actor (and, for restream, the publication)
server-side. Skills never set `X-Actor` or `X-Publication` — there is no header
to build, because there is no HTTP call from the skill.

## Retry / failure policy

- **Transient / `5xx` / network** on a write tool → retry the tool call, up to
  3×, brief backoff (500 ms → 1 s → 2 s). No re-signing, no timestamps.
- **Authorization error** → the connector session isn't a brand-admin or
  super-admin. **Stop** and tell the user to use an account with that role.
  There is no fallback.
- **Request-shape error** (`invalid_field`, `not_found` on a show) → fail loud
  for that show; retry can't fix a bad request. Continue to the next show.
- **Junction `not_found`** on `set_show_cohost_invite` → the cohost's junction
  row hasn't been mirrored yet by the reconcile cron. Skip that one cohost,
  continue; a re-run after the next reconcile cycle succeeds.

## Decisions

- Connector-only — no `.creds` token, no HMAC, no direct `gateway`/`data`
  hostname call under any circumstance.
- Admin authorization rides on the creator's OAuth connector session, not a
  workspace file.
- The actor (and publication) are stamped by the tools; skills don't set them.
- `changed: false` is success.
