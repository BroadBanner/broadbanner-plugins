# Data Worker authentication — RETIRED

This reference is retired. As of the gateway migration, `substack-schedule-live`
no longer talks to `data.broadbanner.com` directly; all reads and writes go
through `https://gateway.broadbanner.com/v1` with a capability-token Bearer.

See **[gateway-auth.md](./gateway-auth.md)** for the current pattern:

- Credential location: `<PROJECT_ROOT>/.creds/gateway.token`
- Routes used: `GET /v1/shows`, `PATCH /v1/shows/:id`, `PATCH /v1/shows/:id/{hosts,guests}/:cid`
- No HMAC signing, no `BROADBANNER_ENC_PASSPHRASE` read, no re-signing per call
- `X-Actor` is set by the Gateway automatically from the token's `sub`

If you arrived here from a stale link in the skill or another plugin, please
update the link to point at `references/gateway-auth.md`.
