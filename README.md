# AutoClick Pilot

Chrome extension (Manifest V3, plain JS, no build step) that clicks an element for you when a page loads. A rule is a site plus an element found by CSS selector, ID, name or ARIA label. On a matching page it waits for the first visible match (up to 10 s by default, with an optional delay) and clicks it once. The toolbar badge shows how many clicks happened in the tab.

## Install

`chrome://extensions` → turn on Developer mode → **Load unpacked** → pick this folder. Requires Chrome 116+.

## Usage

Click the toolbar icon to see your rules and add one; the site is prefilled from the current tab. **Full settings** has the same UI plus Export/Import (JSON). Each rule can be edited (pencil), switched off, or deleted (trash, then **Delete?**).

| Find by | You type | Clicks the first visible match of |
|---|---|---|
| CSS | `.actions > button.primary` | the selector as typed |
| ID | `start-button` | `#start-button` |
| Name | `continue` | `[name="continue"]` |
| ARIA label | `Accept all cookies` | `[aria-label="Accept all cookies"]` |

ID, Name and ARIA values are exact matches and escaped. **Timing** sets a delay before the click (0–60 s) and how long to wait for the element (1–120 s).

## Site matching

| Site | Matches | Doesn't match |
|---|---|---|
| `example.com` | `example.com/*`, `app.example.com/*`, http and https | `notexample.com` |
| `example.com/login` | `/login`, `/login/step-2` | `/login-help`, `/` |
| `localhost:3000` | `localhost:3000/*` | `localhost:8000/*` |

Accepted hosts are `localhost`, IPv4 addresses and dotted domain names. Subdomains are only included for domain names.

## Permissions

The extension asks for access to a site only when you add a rule for it, never for all sites. Deleting the last rule for a site removes that access. If you decline the prompt, or import rules, the site's group shows **Grant access**. Rules are stored in `chrome.storage.sync`, so they sync across your Chrome profiles; site access doesn't, so you grant it again on each one.

## Limitations

- **Single-page apps:** in-app navigation that doesn't reload the page doesn't re-run the rules.
- **Frames:** only the top-level page is checked, not iframes.
- **One click per load:** each rule clicks once per page load, using the first visible match.
- **Ports:** Chrome can't limit site access to one port, so access to `localhost` covers every port. A port in the rule's site is still enforced when matching.

## Development

Source: https://github.com/pavankjadda/autoclick-pilot · Author: [pavankjadda](https://github.com/pavankjadda)

```sh
npm test          # unit tests (node:test)
npm run fixture   # serves test/ at http://localhost:8000/fixture.html
npm run zip       # packages the extension
PLAYWRIGHT_FROM=<dir with playwright installed> npm run icons   # re-renders PNGs from icons/*.svg
```

**Manual test:** with the fixture open, add these `localhost` rules, then reload the page: ID `start-button`, Name `continue`, CSS `.actions > button.primary`, ARIA `Accept all cookies` (appears after 2 s), CSS `#late` (appears after 4 s), CSS `.js-link` (a `javascript:` link). All six lines turn green and the badge shows 6.
