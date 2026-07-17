# Admin scheduling tools (MCP connector) — reference

This skill reads and writes the BroadBanner system of record **only through the
BroadBanner MCP connector** (server `broadbanner`). There is no capability
token, no `.creds/gateway.token` file, no config, no workspace mount, and no
request signing. The creator authorizes the connector once via OAuth; the
connector's admin tools proxy to the data plane (Gateway → Data Worker)
server-side and stamp the actor / publication for you.

The tools **fail closed**: a connector session without a **brand-admin** or
**super-admin** role gets an authorization error. Those roles are what the old
admin-tier cap-token (`shows:read` + `restream:read` + `restream:write`) used to
encode — now it's carried by the creator's connector session, not a file in the
workspace.

## Tools

| Tool                      | Args                                                                          | Returns                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `list_schedulable_shows`  | none                                                                          | `{ generatedAt, shows: [...], _fetch: { cfCacheStatus, age, cfRay } }` — the `GET /v1/shows` envelope verbatim, served fresh each call. |
| `get_restream_workspaces` | none                                                                          | `{ accounts: [{ id, workspaces: [{ workspaceName, isDefault, podIds }] }] }` verbatim — the account → workspace → pod-id catalog. |
| `list_restream_events`    | `{ workspace?, event_status? }`                                               | `{ restream_events: [...] }` — the D1 cache. **Informational only**, never a scheduling gate.    |
| `upsert_restream_event`   | `{ showId, publication, event_status, event_id, scheduled_at, workspace? }`   | `{ ok, created, changed, updated }`                                                              |

`changed: false` is success — the row already matched what you sent.

### `list_schedulable_shows`

Replaces the old `curl .../shows?fresh=1&_cb=...` snapshot read plus its
temp-file/header-dump machinery. Each call is authoritative (no local file to go
stale). The per-show schema is unchanged. Use `_fetch.cfCacheStatus` /
`_fetch.age` / `_fetch.cfRay` for the freshness-gate abort diagnostic (see
SKILL.md Step 0).

### `get_restream_workspaces`

Replaces `GET /v1/restream-workspaces`. The response is account-oriented —
`accounts[i]` is a Restream account (1:1 with networks), each with its
`workspaces[]` and per-workspace `podIds[]`. Look up a pod by walking
`accounts[].workspaces[].podIds[]`; the matching workspace's `workspaceName` is
what you pass to `upsert_restream_event` — **unless `isDefault` is true, in which
case OMIT the `workspace` arg entirely** (never pass an empty string).

### `list_restream_events`

Replaces the courtesy `GET /v1/restream-events?workspace=`. Filters by optional
`workspace` and `event_status`. This is a read of the D1 cache and is **not** an
authoritative "is this scheduled" signal — the browser status badge in Step 2 is
the sole authority. Use it only for an informational log.

### `upsert_restream_event`

Replaces `PATCH /v1/restream-events/:show_id`. INSERTs if no row exists for the
`(show_id, workspace)` pair, otherwise UPDATEs only the fields you pass.

- `publication` (**required**) — the `X-Publication` id (`sotsp`, `babm`, `lr`,
  …). The tool sets the `X-Publication` header from it; without it the call
  fails with a missing-publication error.
- `workspace` (**optional**) — the Restream workspace name. **OMIT it when the
  show's workspace is the account default** (`isDefault === true`) or when the
  account has no workspace selector. Never pass an empty string. The tool
  applies it as the `workspace` query param.

Allowed write fields (the tool sends `X-Actor: skill:restream-schedule-live`,
which the Data Worker constrains to these three):

| Field          | Type             | Notes                                     |
| -------------- | ---------------- | ----------------------------------------- |
| `event_id`     | `string \| null` | Restream event UUID captured from the UI  |
| `event_status` | enum             | `"scheduled"` after a successful schedule |
| `scheduled_at` | `string \| null` | ISO 8601 timestamp                        |

Response shapes:

```json
{ "ok": true, "created": true,  "changed": true, "updated": { /* full row */ } }        // INSERT
{ "ok": true, "created": false, "changed": true, "updated": { /* changed fields */ } }  // UPDATE
```

A `not_found` means the `show_id` doesn't exist in D1's `shows` table (reconcile
lag or a deleted show) — surface it; do not retry blindly.

## Actor / publication — set by the tool

`upsert_restream_event` sets `X-Actor: skill:restream-schedule-live`,
`X-Publication` (from `publication`), and the `workspace` query param itself.
The skill never builds a header or a query string — there is no HTTP call from
the skill.

## Retry / failure policy

- **Transient / `5xx` / network** on `upsert_restream_event` → retry the tool
  call, up to 3×, brief backoff (500 ms → 1 s → 2 s). Upsert is atomic — no
  read-then-write race.
- **Authorization error** → the connector session isn't a brand-admin or
  super-admin. **Stop** and tell the user. There is no fallback.
- **Request-shape error** (`invalid_field`, `field_not_allowed_for_actor`,
  missing publication, `not_found` on the show) → fail loud; retry can't fix a
  bad request. For `not_found`, suggest a reconcile or manual show add.

## Decisions

- Connector-only — no `.creds` token, no HMAC, no direct `gateway`/`data`
  hostname call under any circumstance.
- Admin authorization rides on the creator's OAuth connector session, not a
  workspace file.
- Actor, publication, and workspace routing are handled by the tools.
- `changed: false` is success.
