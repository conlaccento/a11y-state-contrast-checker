<img src="icons/icon128.png" width="72" alt="" align="left" />

# A11y State Contrast Checker

A Manifest V3 Chrome extension that runs an **on-demand WCAG colour-contrast
audit of interactive states** — `:hover`, `:focus` and `:focus-visible` — on any
web page.

<br clear="left" />

## Why

axe-core, Lighthouse and WAVE only inspect the DOM in its **resting** state at
scan time. They miss contrast violations that appear **only** while an element is
hovered or focused — a faint hover text colour, a near-invisible focus ring, an
icon that washes out on hover. This extension forces those states on the real
rendering engine and measures the resulting computed styles, so those issues
stop slipping through.

## What it checks

- **1.4.3 Contrast (Minimum)** — text vs. background on `:hover` / `:focus`,
  walking up the ancestor chain (across shadow hosts) to resolve a solid
  background, with alpha compositing. 4.5:1, or 3:1 for large text.
- **1.4.11 Non-text Contrast** — the focus ring (`outline-color`, or a
  `box-shadow` used as a ring) vs. its surroundings. 3:1.
- **1.4.11 (icons)** — for icon-only controls, the SVG `fill` / `stroke` vs. the
  background. 3:1.

`:focus` and `:focus-visible` are handled separately: the actual matched selector
decides which pseudo-class is forced.

## Installation

The extension is not on the Chrome Web Store — install it unpacked:

1. **Download the code** — either clone it:
   ```bash
   git clone https://github.com/conlaccento/a11y-state-contrast-checker.git
   ```
   or download the ZIP from GitHub (**Code ▸ Download ZIP**) and unzip it.
2. Open **`chrome://extensions`** in Chrome (or a Chromium browser).
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the project folder
   (`a11y-state-contrast-checker` — the one containing `manifest.json`).
5. The green icon appears in the toolbar. Pin it if you like (puzzle-piece menu ▸ pin).

To update later: `git pull` (or re-download), then click the **↻ reload** button
on the extension's card in `chrome://extensions`.

## Usage

1. Open any website.
2. Click the extension icon, then **Run audit**.
3. Watch the progress, then read the results table: element selector, state,
   WCAG check, measured ratio, required ratio, pass/fail.
4. Click a row's element button to scroll to and highlight that element on the
   page for visual verification.

> **The yellow bar is expected.** While a scan runs, Chrome shows its
> *"… started debugging this browser"* bar — that is how the extension forces the
> interactive states via the DevTools protocol. It disappears when the scan ends.
> If DevTools is already open on the tab the debugger can't attach; close it and
> retry.

### Try it

Open `test/fixture.html` in Chrome and run the audit. It contains controls that
pass at rest but fail on hover/focus, alongside passing counterparts.

## How it works

Instead of re-implementing the CSS cascade, the extension drives the **Chrome
DevTools Protocol** (`chrome.debugger`) so the browser itself resolves
specificity, `!important`, custom properties and media queries:

1. The active tab is scanned for candidate controls
   (`a, button, input, select, textarea, [role="button"], [tabindex]`), piercing
   shadow roots.
2. All three states are force-applied (`CSS.forcePseudoState`) so
   `CSS.getMatchedStylesForNode` reveals which author rules target each state.
   (Resting matched styles do **not** include pseudo-class rules.)
3. For each relevant state, the state is forced and an injected script reads
   `getComputedStyle()` on the real element and computes the WCAG ratio.
4. The forced state is reset between elements; the debugger detaches at the end.

## Development

No build step and no runtime dependencies. Edit the files and reload the
extension.

- `manifest.json` — MV3 manifest (permissions: `debugger`, `activeTab`, `scripting`).
- `background.js` — service worker; CDP orchestration.
- `page-functions.js` — self-contained functions injected into the page.
- `popup.html` / `popup.css` / `popup.js` — the UI.
- `test/fixture.html` — page with deliberate state-only violations.
- `test/audit-e2e.mjs` — end-to-end regression test.

### Running the test

Requires Node 21+ (for the global `WebSocket`) and a local Chrome:

```bash
node test/audit-e2e.mjs
# Chrome auto-detected on macOS/Linux, or: CHROME=/path/to/chrome node test/audit-e2e.mjs
```

It launches headless Chrome, runs the full audit flow against the fixture, and
asserts the four deliberate failures are caught.

### Building the store package

```bash
npm run package   # or: bash scripts/package.sh
```

Produces `dist/a11y-state-contrast-checker-v<version>.zip` containing only the
runtime files (manifest, scripts, popup, icons) — ready to upload to the Chrome
Web Store.

## Accessibility of the extension UI

The popup is built to meet WCAG 2.1 AA itself: all colours verified ≥ 4.5:1
(text) / ≥ 3:1 (non-text) in both light and dark themes; result rows are real
keyboard-operable buttons; progress is a `role="progressbar"` with milestone-only
live announcements; pass/fail is conveyed by text, not colour alone;
`prefers-reduced-motion` is respected.

## Limitations

- Background resolution uses `background-color` layers only (not images/gradients).
- Large pages are capped (1500 elements / 60s) and return partial results.
- Cross-origin iframes are not scanned.
- A state is attributed to a control only when that control is the **subject** of
  the pseudo-class selector (e.g. `button:hover`, `.icon-btn:hover` with
  `fill: currentColor`). Rules whose subject is a descendant (e.g.
  `.card:hover .label`) are not attributed to the control.

## Privacy

The extension collects no data and makes no network requests — everything runs
locally. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © 2026 Antonio Trifirò
