# JavaScript Verification Snippets

All browser-side verification for the Substack live stream scheduling workflow. These snippets supplement screenshot-based checks, especially in dark mode where modal screenshots may render poorly.

## Verify modal loaded (Step 2)

Run after navigating to the `substackLiveUrl`. The `?action=setup-live-stream` parameter should auto-open the modal.

```javascript
const modal = document.querySelector('[role="dialog"]');
const titleInput = modal?.querySelector('input[placeholder*="title"]');
const toggles = modal?.querySelectorAll('[role="switch"], input[type="checkbox"]');
JSON.stringify({
  modalFound: !!modal,
  titleInputFound: !!titleInput,
  toggleCount: toggles?.length || 0
});
```

## Verify title entry (Step 3a)

```javascript
const titleInput = document.querySelector('input[placeholder*="title"]');
JSON.stringify({ titleValue: titleInput?.value });
```

## Fallback title entry via native setter (Step 3a)

Use when the `type` action doesn't register in the input field:

```javascript
const titleInput = document.querySelector('input[placeholder*="title"]');
if (titleInput) {
  titleInput.focus();
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(titleInput, '<SHOW_TITLE>');
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  titleInput.dispatchEvent(new Event('change', { bubbles: true }));
}
JSON.stringify({ titleValue: titleInput?.value });
```

Replace `<SHOW_TITLE>` with the actual show title.

## Format scheduledStartLocal to Substack date format (Step 3b)

```javascript
const iso = '<SCHEDULED_START_LOCAL>';
const [datePart, timePart] = iso.split('T');
const [year, month, day] = datePart.split('-');
let [hours, minutes] = timePart.split(':').map(Number);
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12 || 12;
const formatted = `${month}/${day}/${year}, ${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
formatted;
```

## Verify date/time entry (Step 3b)

```javascript
const dateInput = document.querySelector('input[type="text"][value*="/"]') ||
  document.querySelector('input[placeholder*="date"]') ||
  Array.from(document.querySelectorAll('input')).find(i => /\d{2}\/\d{2}\/\d{4}/.test(i.value));
JSON.stringify({ dateValue: dateInput?.value });
```

## Read current "person going live" dropdown value (Step 3d)

```javascript
const hostSelect = document.querySelector('select') ||
  document.querySelector('[class*="select"]');
const hostName = hostSelect?.value || hostSelect?.textContent?.trim();
JSON.stringify({ currentHost: hostName });
```

## List all dropdown options for primary host selection (Step 3d)

Use when the current dropdown value doesn't match `primaryHost.name` and you need to select the correct person:

```javascript
const select = document.querySelector('select');
const options = Array.from(select?.options || []);
const optTexts = options.map((o, i) => ({ index: i, text: o.text, value: o.value, selected: o.selected }));
JSON.stringify({ options: optTexts });
```

After identifying the correct option, set it via JS:

```javascript
const select = document.querySelector('select');
const targetName = '<PRIMARY_HOST_NAME>';
const option = Array.from(select?.options || []).find(o =>
  o.text.toLowerCase().includes(targetName.toLowerCase())
);
if (option && select) {
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
JSON.stringify({ selected: option?.text || null });
```

Replace `<PRIMARY_HOST_NAME>` with the value from `show.primaryHost.name`.

## Verify "Continue" button is available (Step 3g)

After enabling both "Schedule for a future date" and "Invite co-hosts" toggles, the button should read "Continue" (not "Generate stream key").

```javascript
const modal = document.querySelector('[role="dialog"]');
const buttons = Array.from(modal?.querySelectorAll('button') || []);
const btnTexts = buttons.map(b => b.textContent?.trim());
const continueBtn = buttons.find(b => b.textContent?.trim() === 'Continue');
const scheduleBtn = buttons.find(b => /schedule stream/i.test(b.textContent));
JSON.stringify({
  allButtons: btnTexts,
  continueFound: !!continueBtn,
  scheduleFound: !!scheduleBtn
});
```

## Extract Substack username from host data (Step 4b)

```javascript
function extractUsername(substackUrl, platformUrl, name) {
  // Try substackUrl with @ format
  const atMatch = substackUrl?.match(/substack\.com\/@([^\/\s]+)/);
  if (atMatch) return { username: atMatch[1], source: 'substackUrl' };

  // Try platformUrl subdomain
  const subdomainMatch = platformUrl?.match(/https?:\/\/([^.]+)\.substack\.com/);
  if (subdomainMatch) return { username: subdomainMatch[1], source: 'platformUrl' };

  // Fallback to name
  return { username: name, source: 'name-fallback' };
}
```

## Verify co-host search results (Step 4c)

```javascript
const modal = document.querySelector('[role="dialog"]');
const searchInput = modal?.querySelector('input[type="text"], input[type="search"]');
const checkboxes = modal?.querySelectorAll('input[type="checkbox"]');
const userItems = modal?.querySelectorAll('[class*="result"], [class*="user"], [class*="item"], [class*="row"]');
JSON.stringify({
  searchValue: searchInput?.value,
  checkboxCount: checkboxes?.length || 0,
  userCount: userItems?.length || 0,
  users: Array.from(userItems || []).map(u => u.textContent?.trim().slice(0, 100))
});
```

## Verify co-host selection count (Step 4d)

```javascript
const modal = document.querySelector('[role="dialog"]');
const inviteBtn = Array.from(modal?.querySelectorAll('button') || [])
  .find(b => /invite.*co-host|generate.*stream/i.test(b.textContent));
JSON.stringify({
  inviteBtnText: inviteBtn?.textContent?.trim(),
  inviteBtnEnabled: !inviteBtn?.disabled
});
```

## Capture stream credentials (Step 5)

```javascript
const modal = document.querySelector('[role="dialog"]');
const allInputs = modal?.querySelectorAll('input[type="text"], input[readonly], textarea');
const codeBlocks = modal?.querySelectorAll('code, pre, [class*="key"], [class*="url"], [class*="stream"]');
const inputValues = Array.from(allInputs || []).map(el => ({
  tag: el.tagName,
  value: el.value || el.textContent?.trim(),
  label: el.previousElementSibling?.textContent?.trim() ||
    el.closest('label')?.textContent?.trim() ||
    el.getAttribute('aria-label')
}));
const codeValues = Array.from(codeBlocks || []).map(el => ({
  tag: el.tagName,
  text: el.textContent?.trim(),
  className: el.className
}));
JSON.stringify({ inputs: inputValues, codeBlocks: codeValues });
```

## Identify stream URL vs stream key from captured values

The stream URL contains a protocol prefix (`rtmp://`, `rtmps://`). The stream key is an alphanumeric string without a protocol. If both are in input fields, use label text to disambiguate ("Stream URL", "Server URL", "Stream key", "Key").
