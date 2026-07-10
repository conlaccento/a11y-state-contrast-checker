# Privacy Policy — A11y State Contrast Checker

_Last updated: 10 July 2026_

**A11y State Contrast Checker does not collect, store, transmit, or share any
personal data.**

## What the extension does

The extension runs entirely on your device. When you click its icon and press
**Run audit**, it inspects the currently open page to measure the colour
contrast of interactive states (`:hover`, `:focus`, `:focus-visible`) and shows
the results in its popup. All processing happens locally in your browser.

## Data collection

- **No personal data** is collected or processed.
- **No analytics, telemetry, or tracking** of any kind.
- **No data is sent to any server.** The extension makes no network requests and
  has no backend.
- **No data is stored** beyond the transient audit results held in memory while
  the popup is open; they are discarded when the scan is re-run or the browser
  session ends.
- **No data is sold or shared** with third parties.

## Permissions

The extension requests only what its single function needs:

- **`debugger`** — to force the real `:hover` / `:focus` / `:focus-visible`
  states on the page via the Chrome DevTools Protocol, so contrast can be
  measured in those states. It reads style information only; it does not record
  page content or send it anywhere.
- **`activeTab`** — temporary access to the tab you explicitly run the audit on,
  granted only when you invoke the extension.
- **`scripting`** — to read the page's computed styles for the contrast
  calculation and to highlight an element when you click a result.

## Open source

The full source code is public and auditable at
<https://github.com/conlaccento/a11y-state-contrast-checker>.

## Contact

Questions about this policy: antonio@blackstudio.it
