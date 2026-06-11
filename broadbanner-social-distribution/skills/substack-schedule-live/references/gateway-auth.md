# Gateway authentication

Skills that read or write the BroadBanner system of record now go through
`https://gateway.broadbanner.com/v1` with a capability-token Bearer. There is
no HMAC fallback. The Gateway proxies to the Data Worker on the inside; skills
never speak to `data.broadbanner.com` directly.

## Credential location

The capability token lives **inside the workspace** at:

```
<PROJECT_ROOT>/.creds/gateway.token
```

`<PROJECT_ROOT>` is the mounted workspace folder (the one containing
`broadbanner.config.json` and `Social-Distribution/`). The file is auto-issued
by `banner-blast init` and `banner-admin init` when the operator's D1
`contributors.is_admin === 1`, with these claims:

```
sub:  <user email>
caps: ["posts:write", "shows:read", "shows:write"]
pods: []                              # unrestricted — admin-grade
ttl:  90 days
```

Non-admin operators get a token with only `posts:write` and their pod-scoped
allowlist — those tokens cannot drive this skill. The Gateway will return
`403 forbidden — missing capability: shows:write`.

Read the file directly with the Read tool. No JSON parsing — the file is a
single line, the entire `bb1.<payload>.<sig>` token. Trim trailing whitespace
if any.

## Bearer header

```
API_BASE = "https://gateway.broadbanner.com/v1"
AUTH_HDR = "Authorization: Bearer ${GATEWAY_TOKEN}"
```

Reuse the same `AUTH_HDR` for every request. The cap-token is opaque to
skills — no re-signing per call, no per-route resource string. The Gateway
verifies the token once on inbound, then mints whatever the Data Worker needs
for its own HMAC scheme.

## Routes used by this skill

| Operation                                          | Verb + path                                                  |
|----------------------------------------------------|--------------------------------------------------------------|
| Fetch snapshot                                     | `GET /v1/shows`                                              |
| Mark show in-progress / scheduled                  | `PATCH /v1/shows/<show_id>`                                  |
| Set cohost invite URL (host)                       | `PATCH /v1/shows/<show_id>/hosts/<contributor_id>`           |
| Set cohost invite URL (guest)                      | `PATCH /v1/shows/<show_id>/guests/<contributor_id>`          |

### GET /v1/shows

Returns the same `wix-latest`-shaped JSON the legacy
`data.broadbanner.com/snapshots/shows-latest.json` endpoint returns:

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

### PATCH /v1/shows/:id

Partial-update of managed columns. Omitted fields are left alone. Updatable
fields:

| Field                       | Type             | Notes                                              |
|-----------------------------|------------------|----------------------------------------------------|
| `schedule_state`            | enum             | `"unscheduled" \| "title_customized" \| "substack_scheduling" \| "substack_scheduled" \| "live" \| "completed"` (verbose vocabulary post-migration 0016) |
| `substack_livestream_url`   | string \| null   | Public Substack live URL (renamed from `livestream_link` in 0016) |
| `restream_stream_key`       | string \| null   | Stream key captured from Substack                  |

The pre-0016 column `substack_live_url` was retired in the same migration. Senders MUST NOT include it; the Data Worker will reject it with `invalid_field`.

```bash
curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  -d '{"schedule_state":"substack_scheduled","substack_livestream_url":"...","restream_stream_key":"..."}'
```

Response shapes (passed through from the Data Worker):

```json
{ "ok": true, "changed": true, "updated": { "id": "<show id>", "substack_livestream_url": "..." } }
{ "ok": true, "changed": false }
{ "error": "not_found" }
{ "error": "invalid_field", "message": "..." }
```

`changed: false` is success — the row already matched what you sent.

### PATCH /v1/shows/:id/{hosts,guests}/:contributor_id

Single field allowed: `cohost_invite_url: string | null`.

```bash
curl -sS -X PATCH "${API_BASE}/shows/${SHOW_ID}/hosts/${CONTRIBUTOR_ID}" \
  -H "${AUTH_HDR}" \
  -H "Content-Type: application/json" \
  -d '{"cohost_invite_url":"https://substack.com/?live_stream_invite_id=12345"}'
```

## X-Actor — set automatically

The Gateway derives the outbound `X-Actor` header from the cap-token's `sub`
claim and forwards it to the Data Worker for the change_log. **Do not set
X-Actor yourself** — the Gateway's value wins, and your value would just be
overwritten. If the workspace token was issued for the user, the change_log
will record their email; if it was issued specifically as
`skill:substack-schedule-live`, that value lands instead.

## Retry policy

Exponential backoff. Max 3 retries. Base 500 ms, doubling each attempt
(500 ms → 1 s → 2 s).

- Retry on **5xx** or network errors.
- **Do not** retry **4xx** — they indicate a request-shape bug, an expired
  token, or a missing capability. Fail loud so the user sees the cause.
- **No re-signing.** Unlike the legacy HMAC flow, the cap-token has no
  per-call timestamp. Re-use the same Bearer value across all retries.

Reference bash wrapper:

```bash
patch_with_retry() {
  local url="$1" body="$2"
  local delay_ms=500

  for attempt in 1 2 3 4; do
    local response status
    response=$(curl -sS -X PATCH "$url" \
      -H "${AUTH_HDR}" \
      -H "Content-Type: application/json" \
      -w "\n%{http_code}" \
      -d "$body" 2>&1)
    status=$(echo "$response" | tail -n1)

    if [[ "$status" =~ ^2 ]]; then
      echo "$response" | sed '$d'
      return 0
    fi
    if [[ "$status" =~ ^4 ]]; then
      echo "PATCH $url failed with $status (no retry on 4xx)" >&2
      echo "$response" | sed '$d' >&2
      return 1
    fi
    if (( attempt < 4 )); then
      sleep "$(awk "BEGIN { print $delay_ms / 1000 }")"
      delay_ms=$(( delay_ms * 2 ))
    fi
  done

  echo "PATCH $url exhausted retries" >&2
  return 1
}
```

## Failure-mode quick reference

| Status                                                    | Meaning                                            | Action                                              |
|-----------------------------------------------------------|----------------------------------------------------|-----------------------------------------------------|
| `401 unauthorized`                                        | Cap-token missing, malformed, or expired           | Stop. Tell user to re-run init or reissue token.    |
| `403 forbidden — missing capability: shows:write`         | Workspace token isn't admin-tier                   | Stop. User needs `is_admin=1` in D1.                |
| `404 not_found` (PATCH /v1/shows/:id)                     | Show id doesn't exist                              | Fail loud for this show, continue to next.          |
| `404 not_found` (PATCH /v1/shows/:id/{hosts,guests}/:cid) | Junction row missing — reconcile lag               | Skip this cohost, continue. Re-run after reconcile. |
| `400 invalid_field`                                       | Bad payload field name or value                    | Fail loud — this is a skill bug.                    |
| `502 bad_gateway`                                         | Data Worker unreachable from Gateway               | Stop. Do NOT bypass to `data.broadbanner.com`.      |
| `5xx` other / network                                     | Transient                                          | Retry per policy above.                             |

## Decisions

- Gateway-only — no HMAC fallback under any circumstance.
- Cap-token is reused as-is across all calls in a run.
- `X-Actor` is set by the Gateway from the token's `sub`; skills don't set it.
- `changed: false` is success.
- 4xx fails loud, no retry. 5xx retries with exponential backoff.
