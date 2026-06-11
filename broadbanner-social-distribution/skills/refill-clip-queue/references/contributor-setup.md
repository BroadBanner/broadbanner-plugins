# Contributor setup — personal Substack clip queue

Three skills let any contributor automatically post the clips for the shows
**they** host to **their own** Substack. It is not specific to one person or one
brand. The pipeline is two halves joined by the local `Social-Distribution/`
folder:

```
refill-clip-queue        (networked, ~hourly)        drain-clip-queue   (local, ~30m, LOCAL tz)
  Gateway GET /v1/posts                                 scan queue for due
  → pull-clip-queue.mjs   ── writes pending ──►  Social-Distribution/  ──►  substack-video-note
    (limiter, dedup,          *_restream-clip_*.json                         posts ONE due clip,
     recency)                 { substack: pending,                           marks it posted
                                release_at: +0/+30/+60m }
```

- **`refill-clip-queue`** is the *producer*: it fetches the caller's pending
  clips from the Gateway (via an in-browser fetch — Cowork bash has no network),
  runs `pull-clip-queue.mjs`, and writes a local pointer per new clip with
  `release_at` staggered ~30 min apart (timezone-safe elapsed offsets). It never
  posts and imposes no time-of-day window (it runs in UTC and can't know the
  user's timezone — the drain cron owns the window).
- **`drain-clip-queue`** is the *consumer*: its cron (`*/30 9-21` in the user's
  LOCAL timezone) is what paces posting. Each tick it picks the oldest due clip
  and invokes **`substack-video-note`** to post it — one per ~30 min, 9am-9pm
  local. It never touches the network.

They don't call each other — they share the `Social-Distribution/` directory.
That decouples the (networked, infrequent) pull from the (local, frequent) post.

## What is automatic vs. what each user sets up

**Automatic — no per-user code, works for multi-brand hosts out of the box:**

- The pull reads `user.effectivePodIds` — a single flat list that can span
  several brands. A host of `babm-pv`, `sotsp-cio`, and `sotsp-im` gets **one**
  queue fed from all three; brand boundaries don't matter to the data path.
- The Gateway `GET /v1/posts` list endpoint is scoped by the caller's `uuid`,
  so it returns exactly the clips fanned out to that user (by their BannerBlast
  `pods[]` enrollment) — across every brand at once.
- `substack-video-note` resolves the Chrome profile **per clip** from
  `chromeProfiles`, so a multi-brand queue can even post different brands to
  different accounts if that's how the profiles are mapped.

**Per-user setup — identity/credential bindings that can't be auto-derived:**

1. **`broadbanner.config.json` → `chromeProfiles`.** Tell `substack-video-note`
   which logged-in Chrome profile owns the Substack account for each clip.
   Resolution order is `byPodId` → `byBrand` → `default`.
   - Host everything to **one** personal Substack (the common hub case):
     ```json
     "chromeProfiles": { "default": "Default" }
     ```
   - Split brands across accounts:
     ```json
     "chromeProfiles": { "byBrand": { "babm": "B&B Profile", "sotsp": "SOTSP Profile" } }
     ```
   The named profile must be a connected Claude-in-Chrome browser logged in to
   that Substack — see `../../../references/chrome-profile-routing.md`.

2. **`.creds/gateway.token`** carrying the `posts:read` capability, and
   **`.creds/userid`** holding the caller's BannerBlast user UUID. Both are
   auto-issued by **`banner-blast init`** — the CLI a creator already uses; no
   admin tooling. The creator, contributor, **and admin** token presets include
   `posts:read` as of `@broadbanner/core` v1.29.0, so a fresh `banner-blast init`
   is all it takes. A token issued before that re-issues on the next
   `banner-blast init` — but only when init can reach the signing key (it's a
   best-effort fetch; if `GATEWAY_SIGNING_KEY` can't be resolved, init keeps the
   existing token and only `userid` is rewritten). A quick check: decode the
   token's middle segment and confirm `caps` contains `posts:read`; if `GET
   /v1/posts` returns `403 Missing capability: posts:read`, the token is stale.

3. **BannerBlast enrollment.** The user must be registered with `pods[]`
   covering every show they host (across all their brands). Per-user fan-out
   only delivers clips to enrolled users — `PUT /users/:uuid/pods`.

4. **`clipQueue` config** (optional — sensible defaults). `limit` (default 5
   queued per refill run) and `maxAgeDays` (default 30 — clips older than this
   are never queued). There is no mode/baseline/window to set: refill queues the
   newest eligible clips up to the limit, marks them ready-now, and dedups
   permanently; the `drain-clip-queue` cron paces posting in your local
   timezone. See the `pull-clip-queue.mjs` header for the full list.

5. **Install BOTH scheduled tasks.** Drop two specs in
   `<PROJECT_ROOT>/.broadbanner/scheduled-tasks/` and register them with the
   `install-scheduled-tasks` skill: `refill-clip-queue` (networked producer,
   ~hourly) and `drain-clip-queue` (local consumer, ~30m). Both shipped templates
   are brand-agnostic. The refill alone fills the queue but never posts; the
   drain alone posts but never refills — you need both.

6. **CORS** on `media.broadbanner.com` (`Access-Control-Allow-Origin:
   https://substack.com`) — a one-time org-wide Cloudflare rule, not per-user.

## The multi-brand answer in one line

A user with shows under multiple brands needs **no special code** — they set
`chromeProfiles` (one `default` line if posting to a single account), get a
`posts:read` token, and enroll their pods. The flat `effectivePodIds` list and
uuid-scoped pull handle the cross-brand fan-in automatically.
