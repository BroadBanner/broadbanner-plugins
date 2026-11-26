# Browser routing and the signed-in check (Substack)

Every Substack posting skill in this plugin reads this file before it opens a tab, and
`substack-composer.md` (typing, verify, restack with a note, scheduling) before it types.
This file answers two questions: **which browser** posts for this account, and **is that browser
really signed in as that account**. Posting under the wrong account is a public mistake,
so a failed check always refuses. It never "tries the other browser".

## 1. Pick the browser

The account a run posts as is `substackHandle` from `get_creator_context` (pass `brand`
when the run is brand-scoped; `brand: babm` → `bannerandbackbone`, no brand → `nickparo`).

| Rule (first match wins) | Browser |
| --- | --- |
| The connector returned `automation.browser` for this brand or item | that value (`chrome` or `builtin`) |
| `substackHandle` is `bannerandbackbone` (Banner and Backbone Media) | **Claude built-in browser** |
| any other handle (Sick of this Shit Publications, `nickparo`, members) | **Chrome** (Claude in Chrome) |

The second row is the interim rule until the connector returns `automation`. Each brand's
account is signed in only in its own browser, so the check in step 3 catches a run that
lands in the wrong one.

A run that touches both accounts (rare): finish one browser's items, then the other's.
Never mix them in one tab.

## 2. Is that browser available?

- **Chrome**: the `claude-in-chrome` tools (`tabs_create_mcp`, `navigate`, `javascript_tool`).
- **Built-in browser**: the `browser_repl` tool (Claude desktop app, local Cowork only).

If the browser this account needs is not available: **attended** → stop and tell the user
which browser the account needs ("Banner and Backbone Media posts from the Claude
built-in browser; open this from the Claude desktop app"). **Unattended** → skip these
items with one line (`skipped: @bannerandbackbone needs the Claude built-in browser`),
mark nothing, and carry on with any items for the other browser.

## 3. Signed-in check (before the first Post click of the run)

Open the working tab on `https://substack.com/home` and run this snippet in the page (same
snippet in both browsers; it only reads):

```javascript
(async () => {
  try {
    const r = await fetch('/api/v1/user/profile/self', { credentials: 'include' });
    if (!r.ok) return JSON.stringify({ signedIn: false, status: r.status });
    const j = await r.json();
    return JSON.stringify({
      signedIn: true,
      handle: (j.handle || '').toLowerCase(),
      adminOf: (j.publicationUsers || []).filter(p => p.role === 'admin').map(p => p.publication && p.publication.subdomain)
    });
  } catch (e) { return JSON.stringify({ signedIn: false, error: String(e) }); }
})()
```

- **Pass**: `signedIn` is true and `handle` equals `substackHandle` (lower case).
- **Refuse** on anything else (not signed in, a login wall, a different handle, an error):
  close only the tabs this skill opened, mark nothing posted, and report
  `Signed in as @{handle or "nobody"}, expected @{substackHandle} ({brand} posts from {browser}). Nothing was posted.`
  Unattended: same line, skip the run's items for this account, keep the rest.
- Do not use "the profile page shows that account" as the check. `substack.com/@handle`
  shows the profile to anyone, signed in or not.

The check runs once per account per run. Re-run it only if a page shows a login wall.

## 4. Driver table

Skills are written in Chrome tool terms. In the built-in browser use the right-hand column.
The in-page snippets (baseline, modal checks, R2 media fetch + DataTransfer upload, Post
click) are the same in both browsers.

| Step in the skill | Claude in Chrome | Built-in browser (`browser_repl`) |
| --- | --- | --- |
| Open a working tab | `tabs_create_mcp`, record `tabId` | `let t = await browser.tabs.create(url)`, record `t.id` in `OPENED_TABS` |
| Set the window to 1200×900 | `resize_window` | `await t.page.setViewportSize({ width: 1200, height: 900 })` |
| Go to a page | `navigate` | `await t.page.goto(url)` |
| Run an in-page snippet | `javascript_tool` with the snippet | `await t.page.evaluate("eval(" + JSON.stringify(SNIPPET) + ")")` (works for snippets that end in a bare expression and for async IIFEs) |
| Read the page text | `get_page_text` | `await t.page.evaluate(() => document.body.innerText)` |
| Click "What's on your mind?" | click | `await t.page.getByText("What's on your mind?").first().click()` |
| `find` a "New post" button | `find` | `await t.page.getByRole('button', { name: /new post/i }).first().click()` |
| Wait N seconds | wait | wait for the thing instead (`locator.waitFor()`, `page.waitForFunction(...)`); else `waitForTimeout(1000)` and look again |
| Type the note text | the skill's insert snippet, then the collapse-to-end + space call (`substack-composer.md` §1) | click `[role="dialog"] .ProseMirror`, `await t.page.keyboard.insertText(TEXT)`, wait 1 s, `press('End')`, then `press(' ')` (`substack-composer.md` §1). Never Backspace-and-retype: it corrupts a trailing URL. Verify the exact text and that Post is enabled (§2) before the Post script |
| Abandon a composer | Escape, then click `Discard` | `press('Escape')`, then `getByRole('button', { name: 'Discard' }).click()` |
| Schedule a note | `substack-composer.md` §7 snippets | testid `composer-schedule-button`, `locator('input[type="time"]').fill('HH:MM')`, `Save`, then the button whose text is exactly `Schedule` |
| Close a tab | `tabs_close_mcp` | `await browser.tabs.close(id)` |

Built-in browser rules (more in `substack-composer.md` §8):
- The baseline snippet can return 0 notes on the profile page (the selectors miss
  Substack's current markup). Verify the post with the copy count in
  `substack-composer.md` §4 (exactly one copy) instead.
- **End the script right before the Post click.** Read the verify result first, then send
  the Post-click snippet as its own script. One Post click per note, ever.
- If a call throws `needs_request_access`, ask with `request_access` for `https://substack.com`
  (and `https://www.bannerandbackbone.com` for the publication) with scope `site`, then
  re-send only the steps that did not run.
- If the user has to sign in, call `browser.show()` and tell them to sign in in the Claude
  desktop app's browser. Never type credentials.
- The built-in browser's sign-ins are shared by every Claude desktop chat. Never sign out,
  never switch accounts, and close only the tabs this skill opened.
