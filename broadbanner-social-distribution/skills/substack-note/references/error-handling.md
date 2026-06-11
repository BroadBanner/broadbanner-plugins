# Error Handling

Detailed recovery procedures for each failure mode in the Substack note posting workflow.

## Not logged in

**Symptom:** Login prompt visible instead of profile page after navigation.

**Action:** Stop immediately. Tell the user to log in manually in the browser. Do not attempt to automate login.

## Modal doesn't open

**Symptom:** Clicking "What's on your mind?" or "New post" does not produce a dialog.

**Recovery:**
1. Use `find` to locate the "New post" button as a fallback selector.
2. If `find` locates it, click it and wait 2 seconds.
3. If `find` fails, suggest the user refresh the page and try again.

## Text entry fails with both methods

**Symptom:** Both click + `type` and the `execCommand` fallback leave `editorText` empty.

**Recovery:**
1. Cancel the modal (click outside it or press Escape).
2. Reopen the composer from Step 3.
3. A fresh modal sometimes resolves ProseMirror state issues where the editor's internal model diverges from the DOM.

## Post button stays disabled after text is visible

**Symptom:** `editorText` shows the note text but `postEnabled` is `false`.

**Recovery:**
1. Wait 1-2 more seconds and re-check with the verification snippet.
2. ProseMirror's button state update is asynchronous — the content model may not have synced yet.
3. If still disabled after 3 checks (spaced 1 second apart), cancel the modal and retry with a fresh composer.

## Modal disappears unexpectedly

**Symptom:** The dialog vanishes without the Post button being clicked.

**Root cause:** Clicks are landing outside the modal due to viewport scaling. This happens when the browser window is wider than 1200px.

**Recovery:**
1. Verify the window was resized to 1200x900 in Step 2.
2. If it wasn't, resize now and restart from Step 2.
3. If it was resized, the page may have re-rendered at a different scale. Navigate again after resizing.

## Page layout changed

**Symptom:** Expected elements (composer trigger, editor, Post button) aren't where the skill expects them.

**Recovery:**
1. Use `find` and `read_page` to discover the current layout.
2. The core flow (open composer -> enter text -> post) is stable even if element positions shift.
3. Look for the ProseMirror editor class (`.ProseMirror`) and `[role="dialog"]` as stable selectors.

## Duplicate post risk

**CRITICAL:** Never retry the Post button click. If post verification is ambiguous:

1. Open a **new tab** to `https://substack.com/@nickparo`.
2. Use `get_page_text` or `read_page` to check if the note text appears.
3. If the note is there, the post succeeded — close the composer tab, close the verification tab, and proceed to Step 6.
4. If the note is NOT there, wait 5 seconds, reload, and check once more. If still absent, cancel and report the failure.

One missed post is recoverable; duplicate posts require manual cleanup.

## ANTI-DUPLICATE GUARD — applies to ALL retries

**Before ANY retry in this workflow** — whether reopening the composer, re-entering text, or re-attempting post — you MUST first check whether the note already posted:

1. Open a new tab to `https://substack.com/@nickparo`.
2. Use `get_page_text` or `read_page` to check if the note text is already on the profile.
3. **If the note is present → STOP. The post succeeded.** Close the composer tab and proceed to Step 6 (write tracker).
4. Only if the note is confirmed absent should you retry any step.

This guard applies even when the failure seems unrelated to posting (e.g., text entry failure, modal dismiss). Substack may have processed a partial submission — for instance, the modal may stay open while the note actually posted in the background. Always verify before retrying.

### Common scenarios where this guard prevents duplicates

- **Modal lingers after Post click:** The post succeeded but the modal didn't close. Without the guard, reopening the composer and posting again creates a duplicate.
- **Text entry "fails" on verification:** The JS check returned empty `editorText`, but the text was actually in ProseMirror's internal state and got posted when the modal was cancelled (Substack auto-saves drafts). Without the guard, retrying from Step 3 posts again.
- **Timeout waiting for modal close:** The 6-second wait expired, but Substack was still processing. The post goes through moments later. Without the guard, any retry creates a duplicate.
