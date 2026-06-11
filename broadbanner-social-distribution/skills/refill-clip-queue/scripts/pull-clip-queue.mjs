#!/usr/bin/env node
/**
 * pull-clip-queue.mjs
 *
 * Feeds a per-user Substack video-note queue from the hosted system.
 *
 * WHY THIS EXISTS
 * Restream clips are ingested into the BannerBlast Worker's KV and fanned out
 * per-user by `pods[]` enrollment. Bluesky / Threads / Instagram are drained
 * SERVER-SIDE by the Worker queue. Substack cannot be (it needs browser
 * automation), so each enrolled user posts their own clips locally via the
 * `drain-clip-queue` -> `substack-video-note` skills. But those skills only read
 * LOCAL `*_restream-clip_*.json` trackers — and nothing writes them for an
 * individual contributor. This script is that missing feed.
 *
 * It takes the caller's pending Substack restream-clips (fetched from the
 * Gateway by the `refill-clip-queue` skill) and writes a few-KB local tracker
 * *pointer* for each (the clip stays single-copy in R2 — the pointer only
 * carries `clip.r2_key`), stamping `release_at` staggered ~30 min apart.
 *
 * TIMEZONE SAFETY: the stagger uses pure elapsed-millisecond offsets from now —
 * never a wall-clock hour — so it is correct in the UTC Cowork sandbox. (The
 * bug this replaces clamped to a 9-21 "window" via getHours() = the sandbox's
 * UTC hour, posting clips in the user's overnight hours.) The actual time-of-day
 * posting window is enforced by the drain-clip-queue cron, which runs in the
 * user's LOCAL timezone and posts one due clip per tick — so clips go out one
 * per ~30 min during the user's daytime, no blast, no overnight posts.
 *
 * It touches NOTHING else: not R2, not the Restream-Worker, not clip storage.
 *
 * ONE HANDS-OFF BEHAVIOR — NO FLAGS, NO MODES
 *   Every run queues up to `limit` of the newest eligible clips. "Eligible" =
 *   pod-authorized, has media, not already queued (permanent dedup), and not
 *   older than `maxAgeDays` (so a huge historical pool is never resurrected).
 *   The limiter + staggered release + drain's one-post-per-tick give a controlled
 *   drip, not a blast. Nothing to remember, nothing to flip — `refill` always
 *   leaves the newest clips queued and ready for `drain` to post.
 *
 * DEDUP (permanent)
 *   A clip is queued at most once, ever. Dedup is the union of (a) clip_ids /
 *   tracker_ids of local `*_restream-clip_*.json` files and (b) a durable
 *   `seen` set in the state file — so a clip stays deduped even after its posted
 *   tracker is cleaned up locally.
 *
 * CONFIG (broadbanner.config.json) — all optional, sane defaults:
 *   user.effectivePodIds        — pods the caller may queue (defense-in-depth).
 *   dirs.socialDistribution     — queue dir (default "./Social-Distribution").
 *   clipQueue.limit             — per-run cap (default 5).
 *   clipQueue.maxAgeDays        — skip clips older than this (default 30).
 *   clipQueue.gatewayBase       — default "https://gateway.broadbanner.com".
 *   clipQueue.fetchCap          — max trackers requested from the Gateway (200).
 *
 * CREDS (<projectRoot>/.creds/)
 *   gateway.token  — bb1 cap-token with `posts:read`.
 *   userid         — the caller's BannerBlast user UUID.
 *
 * USAGE
 *   node pull-clip-queue.mjs [--project <path>] [--limit N] [--dry-run]
 *                            [--fixture <file>] [--gateway <base>]
 *
 *   --fixture <file>   Read the clip list from a local JSON file
 *                      ({ trackers: [...] } or a bare array) instead of the
 *                      network. The `refill-clip-queue` skill always uses this
 *                      (it fetches via an in-browser call — Cowork bash has no
 *                      network — and hands the JSON to this script).
 *
 * Plain Node ESM, zero dependencies — runs cold anywhere `node` exists.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_FILE = ".clip-queue-state.json";
const DEFAULTS = {
  limit: 5,
  maxAgeDays: 30,
  gatewayBase: "https://gateway.broadbanner.com",
  fetchCap: 200,
};

// ── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { project: null, limit: null, dryRun: false, fixture: null, gateway: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") o.project = argv[++i];
    else if (a.startsWith("--project=")) o.project = a.slice(10);
    else if (a === "--limit") o.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) o.limit = Number.parseInt(a.slice(8), 10);
    else if (a === "--fixture") o.fixture = argv[++i];
    else if (a.startsWith("--fixture=")) o.fixture = a.slice(10);
    else if (a === "--gateway") o.gateway = argv[++i];
    else if (a.startsWith("--gateway=")) o.gateway = a.slice(10);
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else process.stderr.write(`warning: unknown option ${a}\n`);
  }
  return o;
}

function expandHome(p) {
  return p.startsWith("~") ? p.replace(/^~(?=$|\/)/, os.homedir()) : p;
}

function findProjectRoot(start) {
  let dir = path.resolve(start);
  const { root } = path.parse(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, "broadbanner.config.json"))) return dir;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function loadConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "broadbanner.config.json"), "utf8"));
  } catch (err) {
    process.stderr.write(`warning: could not parse broadbanner.config.json: ${err.message}\n`);
    return {};
  }
}

function readCred(root, name) {
  try {
    return fs.readFileSync(path.join(root, ".creds", name), "utf8").trim();
  } catch {
    return null;
  }
}

function loadState(distDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(distDir, STATE_FILE), "utf8"));
    if (!Array.isArray(s.seen)) s.seen = [];
    return s;
  } catch {
    return { version: 2, seen: [] };
  }
}

function saveState(distDir, state) {
  fs.writeFileSync(path.join(distDir, STATE_FILE), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** clip_id + tracker-id sets for every restream-clip tracker already in the dir. */
function localSeen(distDir) {
  const clipIds = new Set();
  const trackerIds = new Set();
  let files = [];
  try {
    files = fs.readdirSync(distDir);
  } catch {
    return { clipIds, trackerIds };
  }
  for (const f of files) {
    if (!/_restream-clip_.*\.json$/.test(f)) continue;
    try {
      const t = JSON.parse(fs.readFileSync(path.join(distDir, f), "utf8"));
      if (t?.clip?.clip_id) clipIds.add(t.clip.clip_id);
      if (t?.id) trackerIds.add(t.id);
    } catch {
      /* skip unparseable */
    }
  }
  return { clipIds, trackerIds };
}

/**
 * Relative-offset release scheduler. Spaces clips `gapMs` apart starting at
 * `now` (or after the last-queued clip, so successive runs don't overlap).
 *
 * Crucially this uses ONLY elapsed-millisecond offsets — never a wall-clock
 * hour — so it is timezone-agnostic and safe to run in the UTC Cowork sandbox.
 * (The previous version clamped to a 9-21 "window" via getHours(), which is the
 * sandbox's UTC hour, and posted clips in the user's overnight hours.) The
 * actual time-of-day posting window is still enforced by the drain cron, which
 * runs in the user's LOCAL timezone.
 */
function makeScheduler(state, now, gapMs) {
  let cursor = state.lastReleaseAt ? new Date(state.lastReleaseAt) : null;
  // Reset to now if the stored cursor has already passed (queue drained) or is
  // absurdly far ahead (>24h — a backed-up queue), so it stays anchored to now.
  if (
    !cursor ||
    Number.isNaN(cursor.getTime()) ||
    cursor.getTime() <= now.getTime() ||
    cursor.getTime() > now.getTime() + 86_400_000
  ) {
    cursor = new Date(now);
  }
  return {
    next() {
      const t = cursor;
      cursor = new Date(cursor.getTime() + gapMs);
      return t.toISOString();
    },
    cursorIso() {
      return cursor.toISOString();
    },
  };
}

async function fetchPending({ fixture, gatewayBase, token, uuid, fetchCap }) {
  if (fixture) {
    const body = JSON.parse(fs.readFileSync(fixture, "utf8"));
    return Array.isArray(body) ? body : (body.trackers ?? []);
  }
  const qs = new URLSearchParams({
    uuid,
    source: "restream-clip",
    platform: "substack",
    status: "pending",
    limit: String(fetchCap),
    view: "slim",
  });
  const url = `${gatewayBase.replace(/\/+$/, "")}/v1/posts?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway GET /v1/posts -> ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return body.trackers ?? [];
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    process.stdout.write(
      "Usage: node pull-clip-queue.mjs [--project <path>] [--limit N] [--dry-run] [--fixture <file>] [--gateway <base>]\n",
    );
    return;
  }

  const root = opts.project
    ? path.resolve(expandHome(opts.project))
    : findProjectRoot(process.cwd());
  if (!root || !fs.existsSync(path.join(root, "broadbanner.config.json"))) {
    process.stderr.write("error: no broadbanner.config.json found (pass --project <path>)\n");
    process.exit(1);
  }

  const cfg = loadConfig(root);
  const cq = cfg.clipQueue ?? {};
  const limit = opts.limit ?? cq.limit ?? DEFAULTS.limit;
  const maxAgeDays = cq.maxAgeDays ?? DEFAULTS.maxAgeDays;
  const gatewayBase = opts.gateway ?? cq.gatewayBase ?? DEFAULTS.gatewayBase;
  const fetchCap = cq.fetchCap ?? DEFAULTS.fetchCap;
  const allowedPods = new Set(cfg.user?.effectivePodIds ?? []);

  const distRel = cfg.dirs?.socialDistribution ?? "./Social-Distribution";
  const distDir = path.resolve(root, expandHome(distRel));
  if (!fs.existsSync(distDir)) {
    process.stderr.write(`error: queue dir not found: ${distDir}\n`);
    process.exit(1);
  }

  const now = new Date();
  const cutoffMs = now.getTime() - maxAgeDays * 86_400_000;

  const token = readCred(root, "gateway.token");
  const uuid = readCred(root, "userid");
  if (!opts.fixture && (!token || !uuid)) {
    process.stderr.write(
      "error: missing .creds/gateway.token or .creds/userid (needed to pull from the Gateway)\n",
    );
    process.exit(1);
  }

  let pending;
  try {
    pending = await fetchPending({ fixture: opts.fixture, gatewayBase, token, uuid, fetchCap });
  } catch (err) {
    process.stderr.write(`pull-clip-queue: gateway error — ${err.message}\n`);
    process.exit(2);
  }

  const state = loadState(distDir);
  const seenSet = new Set(state.seen);
  const local = localSeen(distDir);
  const skipped = { dedup: 0, pod: 0, noMedia: 0, stale: 0 };

  // Eligible: pod-authorized, has media, within the recency window, not already
  // queued (local files OR durable seen-set).
  const candidates = [];
  for (const t of pending) {
    const clip = t?.clip;
    const clipId = clip?.clip_id;
    const trackerId = t?.id;
    if (!clip || !clipId || !trackerId) continue;
    if (allowedPods.size > 0 && !allowedPods.has(clip.pod_id)) {
      skipped.pod++;
      continue;
    }
    if (!clip.r2_key && !(clip.public_url || "").includes("media.broadbanner.com")) {
      skipped.noMedia++;
      continue;
    }
    if ((Date.parse(t.created_at) || 0) < cutoffMs) {
      skipped.stale++;
      continue;
    }
    if (seenSet.has(clipId) || local.clipIds.has(clipId) || local.trackerIds.has(trackerId)) {
      skipped.dedup++;
      continue;
    }
    candidates.push(t);
  }

  // Oldest-first so the queue drains in chronological order; cap at `limit`.
  candidates.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
  const toQueue = candidates.slice(0, limit);

  // Stagger release times by `gapMinutes` (default 30, matching the drain
  // cadence) using pure elapsed offsets from now — NO wall-clock window, so it
  // is timezone-safe in the UTC sandbox. (The bug this replaces clamped to a
  // 9-21 "window" via getHours(), i.e. the sandbox's UTC hour, and posted in
  // the user's overnight hours.) The drain cron — in the user's LOCAL timezone —
  // still enforces the actual 9am-9pm posting window; these offsets just make
  // release_at reflect the order and ~30-min spacing of the real posts.
  const gapMs = (cq.spacingMinutes ?? 30) * 60_000;
  const scheduler = makeScheduler(state, now, gapMs);
  const queued = [];
  for (const t of toQueue) {
    const releaseAt = scheduler.next();
    const localTracker = {
      id: t.id,
      source: t.source,
      created_at: t.created_at,
      clip: t.clip,
      platforms: { substack: { status: "pending", release_at: releaseAt } },
      _pulled_by: "pull-clip-queue",
      _pulled_at: now.toISOString(),
      _origin_uuid: opts.fixture ? undefined : uuid,
    };
    const dest = path.join(distDir, `${t.id}.json`);
    if (!opts.dryRun) {
      fs.writeFileSync(dest, JSON.stringify(localTracker, null, 2) + "\n", "utf8");
      seenSet.add(t.clip.clip_id);
    }
    queued.push({ pod: t.clip.pod_id, title: t.clip.title, release_at: releaseAt });
  }

  if (!opts.dryRun) {
    // Clean state — drop legacy keys (mode/initializedAt); carry the cursor so
    // the next run's stagger continues after the last-queued clip.
    saveState(distDir, {
      version: 2,
      seen: Array.from(seenSet),
      lastReleaseAt: scheduler.cursorIso(),
      lastRunAt: now.toISOString(),
    });
  }

  const dryTag = opts.dryRun ? " (dry-run)" : "";
  if (queued.length === 0) {
    process.stdout.write(
      `pull-clip-queue: nothing new${dryTag} — ${pending.length} pending from gateway, ` +
        `skipped ${skipped.dedup} already-queued / ${skipped.pod} off-pod / ` +
        `${skipped.noMedia} no-media / ${skipped.stale} older-than-${maxAgeDays}d\n`,
    );
    return;
  }
  process.stdout.write(
    `pull-clip-queue: queued ${queued.length}/${candidates.length} eligible${dryTag} ` +
      `(limit ${limit}) — staggered ~${(cq.spacingMinutes ?? 30)}m apart; drain posts them in your local 9am-9pm window\n`,
  );
  for (const q of queued) {
    process.stdout.write(`  • ${q.release_at}  ${q.pod}  ${String(q.title).slice(0, 60)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`pull-clip-queue: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
