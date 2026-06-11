# JavaScript Verification Snippets

All browser-side verification for the Substack note posting workflow. These snippets replace screenshot-based verification, which fails in dark mode (modal screenshots render black).

## Capture baseline note (Step 2)

Run this on the profile page before opening the composer. Store the result for comparison in Step 5b.

If the JS snippet below returns empty results, fall back to `get_page_text` or `read_page` to capture the first visible note text from the profile.

```javascript
const notes = document.querySelectorAll('[data-testid="note"], .note-card, article');
const topNoteText = notes.length > 0 ? notes[0]?.textContent?.trim().slice(0, 200) : '';
JSON.stringify({ topNoteText, noteCount: notes.length });
```

## Verify modal opened (Step 3)

```javascript
const modal = document.querySelector('[role="dialog"]');
const editor = modal?.querySelector('.ProseMirror');
JSON.stringify({
  modalFound: !!modal,
  editorFound: !!editor,
  editorRect: editor?.getBoundingClientRect()
});
```

## Verify text entry (Step 4)

```javascript
const modal = document.querySelector('[role="dialog"]');
const editor = modal?.querySelector('.ProseMirror');
const postBtn = Array.from(modal?.querySelectorAll('button') || [])
  .find(b => b.textContent?.trim() === 'Post');
JSON.stringify({
  editorText: editor?.textContent,
  postEnabled: !postBtn?.disabled
});
```

## Fallback text entry via execCommand (Step 4)

Use when the `type` action didn't register (editorText is empty after typing):

```javascript
const modal = document.querySelector('[role="dialog"]');
const editor = modal?.querySelector('.ProseMirror');
const p = editor.querySelector('p');
const range = document.createRange();
range.selectNodeContents(p);
range.collapse(true);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);
document.execCommand('insertText', false, '<NOTE TEXT HERE>');
JSON.stringify({ editorText: editor.textContent });
```

Replace `<NOTE TEXT HERE>` with the actual note text.

After the fallback, wait 1 second for ProseMirror to sync, then re-run the text verification snippet above to confirm `editorText` has the note and `postEnabled` is `true`.

If `postEnabled` is still `false` after the text is visible, wait another second — ProseMirror's button state update is asynchronous.

## Post click with immediate disable (Step 5)

```javascript
const modal = document.querySelector('[role="dialog"]');
const postBtn = Array.from(modal?.querySelectorAll('button') || [])
  .find(b => b.textContent?.trim() === 'Post');
postBtn.click();
postBtn.disabled = true;
postBtn.style.pointerEvents = 'none';
'clicked-and-disabled';
```

## Verify modal closed (Step 5)

```javascript
JSON.stringify({
  modalGone: !document.querySelector('[role="dialog"]'),
  bodyOverflow: window.getComputedStyle(document.body).overflow
});
```

The modal check is informational only. **Do not use modal state to determine whether the post succeeded.** Proceed to Step 5b regardless.

## Second-tab verification (Step 5b)

This is the **single source of truth** for post success. Open a new tab to `https://substack.com/@nickparo`, wait for load, then use `get_page_text` or `read_page` to confirm the note text appears on the profile AND differs from the baseline captured in Step 2.

If JS selectors are available on the verification tab:

```javascript
const notes = document.querySelectorAll('[data-testid="note"], .note-card, article');
const topNoteText = notes.length > 0 ? notes[0]?.textContent?.trim().slice(0, 200) : '';
JSON.stringify({ topNoteText, noteCount: notes.length });
```

Compare `topNoteText` against the baseline from Step 2. If it contains the new note text, the post succeeded. If it matches the old baseline, the note did not post — wait 5 seconds, reload, and check once more before reporting failure.
