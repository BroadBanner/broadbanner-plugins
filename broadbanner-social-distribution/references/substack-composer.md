# Substack note composer: typing, verify, restack with a note, scheduling

Every Substack skill in this plugin that writes a Note reads this file. It holds the steps
that were tested live on `@bannerandbackbone` (Nov 24–25, 2026) and the guards that keep a
run from corrupting a link, posting twice or leaving drafts behind. `browser-routing.md`
still decides the browser and runs the signed-in check first.

`TEXT` below is the approved note text, exactly as given. Never edit it to make a step pass.

## 1. Typing the text (End, then a space)

Substack's link autodetect re-renders the paragraph when the text ends with a URL and leaves
the cursor two characters short of the end. The old trick (Backspace, then retype the last
character) corrupted the URL (`first-heres` → `first-hes es`). A space typed at that cursor
corrupts it too (`first-her es`). Move the cursor to the end first.

**Built-in browser (`browser_repl`):**

```js
var ed = t.page.locator('[role="dialog"] .ProseMirror'); // feed notes are .ProseMirror too: scope to the dialog
await ed.click();
await t.page.keyboard.insertText(TEXT);
await t.page.waitForTimeout(1000);
await t.page.keyboard.press('End');   // puts the cursor back at the true end
await t.page.keyboard.press(' ');     // a real key event: enables Post and unfurls the link card
```

`insertText` alone leaves Post disabled; the real key event is required.

**Chrome (Claude in Chrome):** insert with the skill's `execCommand("insertText")` snippet,
then move the selection to the end of the editor before the space, in one call:

```js
const ed = document.querySelector('[role="dialog"] .ProseMirror');
const r = document.createRange();
r.selectNodeContents(ed);
r.collapse(false);                     // the end of the editor, wherever autodetect left the cursor
const s = window.getSelection();
s.removeAllRanges();
s.addRange(r);
document.execCommand("insertText", false, " ");
```

Then poll every 3 s (up to 15 s) for the link card when the text has a URL. A missing card is
not a failure; a wrong text is (§2).

The trailing space is not part of the note: never include it in `post_text`, a tracker or a
report.

## 2. Verify before Post (exact text, Post enabled)

Run in the page (both browsers), with the same `TEXT`:

```js
(() => {
  const TEXT = `<NOTE TEXT>`;
  const norm = (x) => x.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n+/g, "\n").trim();
  const modal = document.querySelector('[role="dialog"]');
  const ed = modal?.querySelector(".ProseMirror");
  const btn = [...(modal?.querySelectorAll("button") || [])].find(
    (b) => ["Post", "Schedule"].includes(b.textContent.trim()) && !b.matches('[data-testid="composer-schedule-button"]'),
  );
  return JSON.stringify({
    exact: !!ed && norm(ed.innerText) === norm(TEXT),
    editorTail: ed ? norm(ed.innerText).slice(-60) : null,
    postEnabled: !!btn && !btn.disabled,
    card: !!modal?.querySelector('[class*="link-preview"], [class*="linkPreview"], [class*="embed"], [class*="post-preview"], [class*="attachment"]'),
  });
})()
```

- Post only when `exact` and `postEnabled` are both true. `\n\n` in `TEXT` becomes separate
  paragraphs, which is why both sides are normalized.
- `exact` false → abandon the composer (§5), check the profile (§4), reopen and type once
  more. Still false → stop and report `text changed in the editor: …{editorTail}`. Never post
  a note whose text differs from the approved text.
- Post stays disabled → wait 1 s and re-check, up to 3 times.

**End the script right before the Post click.** The Post click is its own call: click once,
then `btn.disabled = true; btn.style.pointerEvents = "none"`.

## 3. After the Post click

- The dialog sometimes stays open although the note posted. **Never click Post again.** Go to
  §4.
- A note can post even when the page looked wrong. Before any retry, run §4 first.

## 4. Verify on the profile (exactly one copy)

Reload `https://substack.com/@{handle}/notes` (wait ~6 s after the click; longer for a video
or image) and count the note:

```js
(() => {
  const KEY = `<first 80 characters of TEXT, whitespace collapsed to single spaces>`;
  const page = document.body.innerText.replace(/\s+/g, " ");
  let n = 0, i = 0;
  while ((i = page.indexOf(KEY, i)) !== -1) { n++; i += KEY.length; }
  return JSON.stringify({ copies: n });
})()
```

- `copies: 1` → posted.
- `copies: 0` → wait 5 s, reload once more (scroll 2× by 2500 px for an older note). Still 0
  → report `Post clicked, not seen yet. Do NOT re-run until checked.` and mark nothing.
- `copies` ≥ 2 → report the duplicate to the user. Never delete anything yourself.

## 5. Abandon a composer (Escape, then Discard)

Escape on a composer with text opens **"Save to drafts?"**. Click `Discard`. Never leave an
abandoned draft behind (they pile up in Drafts). An empty composer closes on Escape.

## 6. Restack an article with a note (article notes)

A note about a Substack article goes out as **Restack with a note** from the article page: the
article card attaches itself and the text carries no URL. This is the owner's preference for
article notes (Nov 25, 2026).

1. Open the article (`https://{publication}/p/{slug}`) in the working tab.
2. Find the restack button. It has no label; it's the large action button with a numeric
   count that is not the heart or the comment button:

   ```js
   (() => {
     const b = [...document.querySelectorAll("button.post-ufi-button")].filter(
       (x) => /style-large/.test(x.className) && /^\d+$/.test(x.innerText.trim()) &&
              !x.querySelector(".lucide-heart, .lucide-message-circle"),
     );
     if (b.length !== 1) return JSON.stringify({ ok: false, found: b.length });
     b[0].click();
     return JSON.stringify({ ok: true });
   })()
   ```

3. In the menu (`role="menuitem"`), click the item whose text is exactly **`Restack with a
   note`**. **Never click the first item blindly:** when the account already restacked the
   article, the first item is **`Undo restack`**. No `Restack with a note` item → Escape and
   stop (`menu-unexpected`).
4. The composer opens with the article card. Type `TEXT` (§1), verify (§2, `card` must be
   true), Post (or schedule, §7), then verify (§4).

The same guard applies to a feed item's restack menu: choose by exact name (`Restack` or
`Restack with a note`), never `Undo restack`.

## 7. Schedule a note in Substack (≤5 days ahead)

Only when the user (or an approved item) gives an explicit release time. Substack's composer
schedules a note itself, so the computer doesn't need to be awake at that time. Works for a
plain note and for Restack with a note.

- Substack offers **today through about 5 days ahead**. A later time → don't schedule: tell
  the user (attended) or leave the item pending (unattended).
- The time is in the browser computer's time zone. Convert the requested time to it first and
  say which zone in the report.

Steps (after §1 and §2 pass, instead of the Post click):

1. Click the schedule icon `[data-testid="composer-schedule-button"]` (aria-label
   `Schedule`). A **"Schedule note"** dialog opens: a calendar, a 24-hour time input and
   `Save`.
2. Pick the day in the calendar (the enabled day button with that date), set the time:
   built-in browser `await t.page.locator('input[type="time"]').fill('18:30')`; Chrome:

   ```js
   const i = document.querySelector('[role="dialog"] input[type="time"]');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "18:30");
   i.dispatchEvent(new Event("input", { bubbles: true }));
   i.dispatchEvent(new Event("change", { bubbles: true }));
   ```

3. The dialog header must read the day and time you meant ("Schedule for Nov 25, 6:30 PM").
   If not, fix it before `Save` (Chrome's time input is the untested half: if the header
   doesn't change, type the time with the computer tool's keys).
4. `Save`. The composer shows **"Scheduled for …"** and the orange button now reads
   `Schedule`.
5. Click that `Schedule` button once (text exactly `Schedule`, **not** the testid icon: two
   elements share the name) and disable it. A toast confirms: "Note scheduled for …".
6. Verify: open a composer → `Drafts` → the note is listed "Scheduled for …" with the right
   time. Close with Escape (Discard if asked; the composer is empty). After the time, §4
   applies.

## 8. Built-in browser (`browser_repl`) notes

- The REPL keeps state between calls: redeclaring `const`/`let` throws. Use `var` for names
  you may set again.
- `browser.tabs.create(url, { active: false })` for background tabs (the active form prints a
  large page snapshot).
- Reset `setViewportSize(null)` at the end of a run that changed it.
- When the browser pane isn't visible, pages aren't drawn and selection popovers don't appear.
  `browser.show()` before steps that need them.
- Screenshot pixels aren't CSS pixels. For coordinate actions use
  `k = (shot.width / s) / innerWidth` from `tab.screenshot({ scale: s })` with `s` ≥ 0.3
  (0.2 rounded enough to drop the last character of a drag).
- A single script that waits more than ~45 s in total hits the script limit. Split long waits
  across calls.
- Synthetic clicks can trigger a page copy handler that writes to the clipboard. Harmless;
  mention it in an attended run.
