# Browser routing and the signed-in check (Restream)

`restream-schedule-live` and `restream-publish-clip` read this file before opening Restream.
Each Restream **account** is signed in in one browser only. A run picks the browser that
holds the account it is about to change, then checks who is signed in before any
irreversible click. A failed check refuses. It never "tries the other browser".

## 1. Which account, which browser

Call `get_restream_workspaces` once. Find the show's or clip's series id in
`accounts[].workspaces[].podIds[]`; that gives the **account** (`accounts[i].id`) and the
workspace. Route by the account, never by the series prefix (`babm-pv` lives in the SOTSP
account's `sots` workspace, so it runs in Chrome).

| Rule (first match wins) | Browser |
| --- | --- |
| The connector returned `automation.browser` for this account | that value (`chrome` or `builtin`) |
| account `babm` (Banner and Backbone Media) | **Claude built-in browser** |
| any other account (`sotsp`, …) | **Chrome** (Claude in Chrome) |

The second row is the interim rule until the connector returns `automation`.

Group a run's items by account, then by workspace. Finish one browser's group before
starting the other. Never mix accounts in one tab.

If the browser an account needs isn't available: **attended** → stop and say which browser
it needs. **Unattended** → skip that account's items with one line
(`skipped: the Banner and Backbone Media Restream account runs in the Claude built-in browser`),
write nothing for them, and carry on with the other account's items.

## 2. Signed-in check (before the first Schedule, Publish or Update click)

On `https://app.restream.io/home`, **wait for the sidebar's "Workspaces" heading** (the app
loads after the page does; read too early and the list is empty), then run this snippet in
the page (it only reads):

```javascript
(() => {
  let user = null;
  try { const j = JSON.parse(localStorage.getItem('user') || 'null'); const u = j && (j.user || j); user = u ? (u.name || u.username || null) : null; } catch (e) {}
  const workspaces = Array.from(document.querySelectorAll('h3 button'))
    .map(b => b.innerText.replace(/^\S\s*\n/, '').trim()).filter(Boolean);
  return JSON.stringify({ signedIn: !!user, user, workspaces });
})()
```

- **Pass** when `signedIn` is true and both hold:
  - `workspaces` (case-insensitive, truncation allowed) **includes every** `displayName` of the
    target account's workspaces in the catalog. Today: `babm` → `Default`; `sotsp` → `Sots`
    and `Time For Life`.
  - `user` equals the account's expected Restream user: the catalog's `restreamUserName`
    when it is set, else the interim value `bannerandbackbone` for `babm`. (An account with
    no known user passes on the workspace list alone; "Default" alone is too generic to
    prove the `babm` account, which is why it also needs the user.)
- **Refuse** on anything else (login page, empty list, another account's workspaces): close
  only this skill's tabs, write nothing, and report
  `Restream is signed in as {user or "nobody"} with workspaces {list}; {account} needs {expected list} in {browser}. Nothing was scheduled or published.`
- If the sidebar's workspace list is collapsed, expand the account header first and read again.
- Run it once per account per run, and again after any page that shows a login form.

## 3. Driver table (built-in browser)

The skills are written in Chrome tool terms. In the built-in browser (`browser_repl`):

| Chrome step | Built-in browser |
| --- | --- |
| `tabs_create_mcp` + `navigate` | `let t = await browser.tabs.create(url)`; record `t.id` |
| `navigate` | `await t.page.goto(url)` |
| `read_page` | `console.log(await t.page.ariaSnapshot())` |
| `find` "…" | `t.page.getByRole(…)` / `getByText(…)`; check `count()` |
| `left_click` | `await locator.click()` (or `t.click(x, y)` from a screenshot) |
| `form_input` | `await locator.fill(value)`; for a date/time picker, click it and pick the value as the skill describes |
| `javascript_tool` | `await t.page.evaluate("eval(" + JSON.stringify(SNIPPET) + ")")` |
| `screenshot` | `await t.screenshot({ scale: 0.5 })` |
| wait N seconds | wait for the thing (`locator.waitFor()`, `page.waitForURL()`); else `waitForTimeout(1000)` and look |
| `tabs_close_mcp` | `await browser.tabs.close(id)` |

- **End the script right before** Schedule, Publish, Update titles or any other click that
  changes Restream or posts to a platform. Read the page, then click in its own script.
- On `needs_request_access`, ask with `request_access` for `https://app.restream.io` (and
  `https://studio.restream.io` if a step opens Studio), scope `site`.
- If the user must sign in, call `browser.show()` and ask them to sign in in the Claude
  desktop app's browser. Never type credentials. Never log out: the built-in browser's
  sign-ins are shared by every Claude desktop chat.
- Closing an unsaved Restream dialog (Escape) asks "Are you sure you want to leave?":
  **Leave** discards, nothing is saved.
- The browser's time zone is the Mac's. Read it from the Schedule modal's label as the skill
  says, exactly as in Chrome.
