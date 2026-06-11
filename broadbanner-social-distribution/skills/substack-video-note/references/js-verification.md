# JavaScript Verification Snippets — Substack Video Note

These snippets supplement the text-only ones in
`../../substack-note/references/js-verification.md`. Re-use the modal,
editor, baseline, post-click, and modal-closed snippets from there. The
snippets below are specific to attaching and verifying the video.

## Locate video file input (Step 5)

Substack mounts a hidden `<input type="file">` for video uploads inside
the composer dialog. Find it (and surface a stable selector) with:

```javascript
const modal = document.querySelector('[role="dialog"]');
const inputs = Array.from(modal?.querySelectorAll('input[type="file"]') || []);
const videoInput = inputs.find(i => {
  const accept = (i.getAttribute('accept') || '').toLowerCase();
  return accept.includes('video') || accept === '' || accept.includes('mp4');
});
if (videoInput && !videoInput.id) {
  videoInput.id = 'bb-substack-video-input';
}
JSON.stringify({
  found: !!videoInput,
  id: videoInput?.id,
  accept: videoInput?.getAttribute('accept'),
  inputCount: inputs.length,
});
```

If `found` is `true`, drive the upload by selector
`#bb-substack-video-input`. If `found` is `false`, fall back to clicking
the video toolbar button (see "Click video toolbar button" below) and
retry the snippet — Substack lazy-mounts the input on first click.

## Click video toolbar button (Step 5 fallback)

```javascript
const modal = document.querySelector('[role="dialog"]');
const candidates = Array.from(modal?.querySelectorAll('button') || []);
const videoBtn = candidates.find(b => {
  const label = (b.getAttribute('aria-label') || '').toLowerCase();
  return label.includes('video');
});
if (videoBtn) videoBtn.click();
JSON.stringify({ clicked: !!videoBtn });
```

If `aria-label` discovery fails, the toolbar buttons are predictable: the
video button is the second `<button>` in the dialog's footer toolbar
(after the image button).

## Verify video attached (Step 5)

Poll this until `videoFound` is `true` AND `postEnabled` is `true`. Up
to 60 seconds.

```javascript
const modal = document.querySelector('[role="dialog"]');
const video = modal?.querySelector('video');
const postBtn = Array.from(modal?.querySelectorAll('button') || [])
  .find(b => b.textContent?.trim() === 'Post');
JSON.stringify({
  videoFound: !!video,
  videoReadyState: video?.readyState ?? null,
  postEnabled: !!postBtn && !postBtn.disabled,
});
```

`readyState >= 1` means metadata is loaded — the preview thumbnail is
visible. Substack briefly enables Post mid-upload before re-disabling it,
so always check that BOTH `videoFound` is true AND Post is enabled
before clicking Post.

## Reuse from substack-note

For the snippets below, see
`../../substack-note/references/js-verification.md`:

- Capture baseline note (Step 2)
- Verify modal opened (Step 3)
- Verify text entry (Step 4)
- Fallback text entry via execCommand (Step 4)
- Post click with immediate disable (Step 6)
- Verify modal closed (Step 6)
- Second-tab verification (Step 7)
