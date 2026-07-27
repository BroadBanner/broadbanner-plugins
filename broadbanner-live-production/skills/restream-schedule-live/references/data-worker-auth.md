# Data Worker authentication — REMOVED

This reference described the Bearer-HMAC scheme used to call
`data.broadbanner.com` directly. The skill no longer does that — both the
snapshot read and the `/restream-events` PATCH now go through the Gateway.

See `gateway-auth.md` for the current auth pattern.

> **Maintainer note:** this file is a tombstone — `git rm` it on the next
> pass through the repo. Kept as a stub only so any stale links from older
> SKILL.md revisions land somewhere informative instead of 404'ing.
