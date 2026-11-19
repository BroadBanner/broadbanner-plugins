---
name: reference-library
description: "Add official long-form documents (field manuals, DoD directives, agency handbooks from .mil or .gov) to your reference library so the writing team can cite and verify them by section. Use when the user says 'add the Law of War Manual to my library', 'capture FM 2-22.3', 'save this directive', 'what's in my reference library', or 'remove that document'. Captures through the server, or through the browser when the official site blocks servers (most .mil sites do). Never edits the shared text."
metadata:
  requiresTool: post_production_distribution
---
# Reference library

Official documents stored once as numbered sections (`5.4.3.2`, `5-75`, `1.2.a`) that Ki
cites and Bruce verifies word for word. The text is shared; **your library** is yours:
search, get and verify only see documents you've added.

## Hard rules

- **Official sources only:** https on a .mil or .gov site. Never news, commentary,
  anything behind a login, classified or CUI, or anything marked "distribution
  restricted" / "for official use only", even if it's posted somewhere.
- **The official URL is the record.** A mirror (e.g. irp.fas.org) can be mentioned to the
  user as a fallback, never captured or cited in its place.
- **Never edit the shared text.** Corrections come only from re-capturing the official source.

## Step 0 — Entitlement (no call)

If this connector has `reference_capture`, carry on. If not, stop: "⚠️ The reference
library comes with the **Production+** add-on (`post_production_distribution`). Nothing was
added." (`../../references/preflight.md`.)

## Add a document

1. Get the **official PDF URL** and, if you can, the short name, issuer, type and the
   version as the document names it ("June 2015, updated July 2023").
2. `reference_capture({ url, shortName, issuer, docType, versionLabel })`.
   - `capture.status` `pending` → it's queued; `ready` + `duplicate: true` → it was already
     stored and is now in your library. Go to step 4.
   - `{ error: "fetch_blocked" }` → the site refuses servers (most .mil). Go to step 3.
   - `not_official` / `not_pdf` → tell the user why and stop.
3. **Browser capture** (needs the browser):
   1. `reference_upload_ticket({ officialUrl: url, …same metadata })` → `browserScript`, `steps`.
   2. Open the official site's **own page** (the origin in `steps`, e.g. `https://ogc.osd.mil/`),
      not the PDF link: a PDF link downloads instead of opening.
   3. Run `browserScript` in that tab with the javascript tool, unchanged.
   4. It returns `{ status, bytes, sha256, result }`. `status: 201` with `result.capture` →
      stored. `hash_mismatch`, `ticket_used`, `ticket_expired` → get a new ticket and run it
      once more. Any other error → report it and stop. The ticket works once and expires in
      20 minutes.
4. `reference_list()` shows progress: big manuals are read about 30 pages a minute. Tell
   the user it's searchable once its status is ready, and give the section style the
   server detected. `pages_without_text` above zero means scanned pages that need OCR
   (not available yet). Say so.

## Spot-check a new document

After it's ready, `reference_search` two or three phrases you can see in the PDF and
`reference_get` the sections they land in. If the numbering looks wrong (`p. N` sections for a
numbered manual, or merged sections), tell the user. Don't work around it.

## List or remove

`reference_list()`; `reference_list({ action: "remove", documentId })` takes it off **your**
list only. `add` puts a document someone else captured onto your list (no re-fetch).

## Report

One line per document: short name, version, how it was captured (server or your
browser), status, sections and pages, and the official link.
