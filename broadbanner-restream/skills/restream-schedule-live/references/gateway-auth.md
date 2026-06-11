# Gateway authentication

This skill talks exclusively to `https://gateway.broadbanner.com/v1` with a
capability-token Bearer. The Gateway proxies to the Data Worker on the
inside; the skill never speaks to `data.broadbanner.com` directly. There is
no HMAC fallback under any circumstance — a 4xx/5xx at the Gateway is the
failure to report, not a signal to route around it.

## Credential location

The capability token lives **inside the workspace** at:

```
<PROJECT_ROOT>/.creds/gateway.token
```

`<PROJECT_ROOT>` is the mounted workspace folder (the one containing
`broadbanner.config.json` and `Social-Distribution/`). The file is
auto-issued by `banner-blast init` and `banner-admin init` when the
operator's D1 `contributors.is_admin === 1`, with these claims (from
`@broadbanner/core` 1.16.0+):

```
sub:  <user email>
caps: ["posts:write", "shows:read", "shows:write", "restream:read", "restream:write"]
pods: []                              # unrestricted — admin-grade
ttl:  90 days
```

Non-admin operators get a token with only `posts:write` and their
pod-scoped allowlist — those tokens cannot drive this skill. The Gateway
will return `403 forbidden — missing capability: restream:write` (or
`restream:read` on the GETs) on first contact.

Read the file directly with the Read tool. No JSON parsing — the file is a
single line, the entire `bb1.<payload>.<sig>` token. Trim trailing
whitespace if any.

## Bearer header

```
API_BASE = "https://gateway.broadbanner.com/v1"
AUTH_HDR = "Authorization: Bearer ${GATEWAY_TOKEN}"
```

Reuse the same `AUTH_HDR` for every Gateway request. The cap-token is
opaque to the skill — no re-signing per call, no per-route resource
string. The Gateway verifies the token once on inbound, then mints
whatever the Data Worker needs for its own HMAC scheme.

## Routes used by this skill

| Operation                                          | Verb + path                                                    | Capability         |
|----------------------------------------------------|----------------------------------------------------------------|--------------------|
| Fetch snapshot                                     | `GET /v1/shows`                                                | `shows:read`       |
| List restream events (informational)               | `GET /v1/restream-events?workspace=<ws>`                       | `restream:read`    |
| Read one restream-event row (informational)        | `GET /v1/restream-events/<show_id>?workspace=<ws>`             | `restream:read`    |
| Upsert restream-event state after scheduling       | `PATCH /v1/restream-events/<show_id>?workspace=<ws>`           | `restream:write`   |

### GET /v1/shows

Returns the same `wix-latest`-shaped JSON the legacy
`data.broadbanner.com/snapshots/shows-latest.json` endpoint returned:

```json
{
  "generatedAt": "<iso>",
  "source": "d1",
  "collectionId": "Import1",
  "window": { ... },
  "count": 116,
  "shows": [ /* per-show schema unchanged */ ]
}
```

**Cache-bypass:** the Gateway forwards the inbound query string to the
Data Worker, so `?fresh=1` works end-to-end (skips the Data-Worker KV
cache) and a `?_cb=<epoch>` random buster defeats any CF edge cache. See
the 2026-05-21 stale-snapshot incident note in the Gateway-Worker source
for context.

```bash
curl -sS "${API_BASE}/shows?fresh=1&_cb=$(date +%s)" \
  -H "${AUTH_HDR}" \
  -H "Accept: application/json" \
  -o /tmp/wix-latest-snapshot.json
```

Consumers should filter `shows[]` exactly as they did against the local
file or the direct Data-Worker endpoint — the per-show schema is
identical (`hasLiveScheduled`, `restreamKey`, `livestreamLink`,
`hosts[]`, `guests[]`, etc.).

### GET /v1/restream-events

List endpoint. Filters via `?workspace=<ws>` and/or `?event_status=<status>`
(both optional). The Gateway forwards the query string unchanged.

```bash
curl -sS "${API_BASE}/restream-events?workspace=sick-of-this-show" \
  -H "${AUTH_HDR}" \
  -H "X-Publication: ${PUBLICATION_ID}"
```

Returns:

```json
{
  "ok": true,
  "cached_at": "<iso>",
  "restream_events": [ /* RestreamEventRow[] */ ]
}
```

This is informational only — Step 0 does NOT use it as a pre-flight
filter (see the warning in `SKILL.md` Step 0).

### GET /v1/restream-events/:show_id

Single-row read. Workspace is part of row identity:
`?workspace=sick-of-this-show` for a workspace-scoped row, omit the param
entirely to address the NULL-workspace row.

```bash
curl -sS "${API_BASE}/restream-events/${SHOW_ID}?workspace=${WORKSPACE}" \
  -H "${AUTH_HDR}" \
  -H "X-Publication: ${PUBLICATION_ID}"
```

Returns `{ ok: true, restream_event: ... }` or 404.

### PATCH /v1/restream-events/:show_id

Upsert. INSERT if no row exists for the (show_id, workspace) pair,
otherwise UPDATE only the fields in the body. Workspace cannot be changed
via PATCH — it identifies the row.

```bash
curl -sS -X PATCH "${API_BASE}/restream-events/${SHOW_ID}?workspace=${WORKSPACE}" \
  -H "${AUTH_HDR}" \
  -H "X-Publication: ${PUBLICATION_ID}" \
  -H "X-Actor: skill:restream-schedule-live" \
  -H "Content-Type: application/json" \
  -d '{"event_status":"scheduled","event_id":"<uuid>","scheduled_at":"<iso>"}'
```

Allowed body fields for `skill:restream-schedule-live`:

| Field          | Type             | Notes                                     |
|----------------|------------------|-------------------------------------------|
| `event_id`     | `string \| null` | Restream event UUID captured from the UI  |
| `event_status` | enum             | `"scheduled"` after a successful schedule |
| `scheduled_at` | `string \| null` | ISO 8601 timestamp                        |

The Data-Worker rejects any other key in the body with `invalid_field`
or, if the key is recognized but owned by another actor (the poller),
`field_not_allowed_for_actor`. Both are 4xx — fail loud, no retry.

Response shapes (passed through from the Data Worker):

```json
{ "ok": true, "created": true,  "changed": true, "updated": { /* full row */ } }   // INSERT
{ "ok": true, "created": false, "changed": true, "updated": { /* changed fields */ } } // UPDATE
{ "error": "not_found" }                                                            // 404 — show_id doesn't exist in D1.shows
{ "error": "field_not_allowed_for_actor", "field": "...", "actor": "..." }          // 403
{ "error": "invalid_field", "message": "..." }                                      // 400
```

## Required headers on `/v1/restream-events/*`

The Data Worker is publication-scoped and enforces a per-actor field
allowlist. The Gateway forwards both headers from the inbound request
unchanged. **Set both explicitly on every call.**

| Header          | Value                                  | Why                                                          |
|-----------------|----------------------------------------|--------------------------------------------------------------|
| `X-Actor`       | `skill:restream-schedule-live`         | Drives the field allowlist on PATCH (`event_id`, `event_status`, `scheduled_at` only). |
| `X-Publication` | The show's publication id (e.g. `sotsp`) | Repo construction requires this; without it the call 400s with `missing_publication`. |

If `X-Actor` is omitted, the Gateway auto-stamps the cap-token's `sub`
(the user's email), which is NOT in the Data-Worker actor allowlist —
the PATCH will 403 with `field_not_allowed_for_actor`. Intentional
fail-loud shape; always send the header.

## X-Actor on `/v1/shows/:id` PATCH (snapshot writes — not used by this skill)

For reference: the `/v1/shows` PATCH paths use the Gateway's automatic
`X-Actor` auto-stamping from the cap-token `sub`, because the Data
Worker's `/shows` route does NOT have an actor-driven field allowlist.
The two routes have different conventions on purpose.

## Retry policy

Exponential backoff. Max 3 retries. Base 500 ms, doubling each attempt
(500 ms → 1 s → 2 s).

- Retry on **5xx** or network errors.
- **Do not** retry **4xx** — they indicate a request-shape bug, an
  expired token, or a missing capability. Fail loud so the user sees
  the cause.
- **No re-signing.** Unlike the legacy HMAC flow, the cap-token has no
  per-call timestamp. Re-use the same Bearer value across all retries.

## Failure-mode quick reference

| Status                                                    | Meaning                                            | Action                                              |
|-----------------------------------------------------------|----------------------------------------------------|-----------------------------------------------------|
| `401 unauthorized`                                        | Cap-token missing, malformed, or expired           | Stop. Tell user to re-run init or reissue token.    |
| `403 forbidden — missing capability: shows:read`          | Workspace token isn't admin-tier                   | Stop. User needs `is_admin=1` in D1.                |
| `403 forbidden — missing capability: restream:write`      | Workspace token predates Core 1.16.0               | Stop. Tell user to re-run `banner-blast init --update`. |
| `403 field_not_allowed_for_actor`                         | X-Actor omitted or wrong on PATCH                  | Bug — verify the request sets `X-Actor: skill:restream-schedule-live`. |
| `400 missing_publication`                                 | X-Publication header missing                       | Bug — verify the request sets `X-Publication`.      |
| `400 invalid_field`                                       | Bad payload field name or value                    | Fail loud — this is a skill bug.                    |
| `400 invalid_workspace`                                   | `?workspace=` value is malformed or is the `__none__` sentinel | Bug — workspace must be kebab-case; omit the param entirely for the NULL row. |
| `404 not_found` (PATCH)                                   | Show id doesn't exist in D1.shows                  | Surface to user; suggest `banner-admin reconcile` or manual add. |
| `502 bad_gateway`                                         | Data Worker unreachable from Gateway               | Stop. Do NOT bypass to `data.broadbanner.com`.      |
| `5xx` other / network                                     | Transient                                          | Retry per policy above.                             |

## Decisions

- Gateway-only — no HMAC fallback under any circumstance.
- Cap-token is reused as-is across all calls in a run.
- `X-Actor` is required on `/v1/restream-events/*` and must be set explicitly to
  `skill:restream-schedule-live`. The Gateway forwards inbound `X-Actor`
  untouched; the Data Worker is the actor-allowlist authority.
- `X-Publication` is required on `/v1/restream-events/*`. Derive it from the
  show's `publicationId` (e.g. `sotsp`, `babm`, `lr`).
- `changed: false` is success.
- 4xx fails loud, no retry. 5xx retries with exponential backoff.
