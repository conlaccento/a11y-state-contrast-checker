# A11y State Contrast Checker

Chrome MV3 extension: on-demand WCAG contrast audit of interactive states
(`:hover`/`:focus`/`:focus-visible`). Uses `chrome.debugger` (CDP) to force real
pseudo-classes, then `getComputedStyle` to measure.

## Commands
- `npm test` — e2e regression: drives headless Chrome via raw CDP against
  `test/fixture.html` (4 deliberate state-only violations) and asserts them.
  Needs a local Chrome. Fast way to verify core changes without reloading the extension.
- `npm run package` — builds the clean Chrome Web Store zip in `dist/` (runtime files only).

## Gotchas
- `CSS.getMatchedStylesForNode` does NOT return pseudo-class rules at rest —
  force the states first (`CSS.forcePseudoState`), then re-fetch. Ignore
  `rule.origin === 'user-agent'` (its default `:focus-visible` matches everything).
- `page-functions.js` functions are injected via `chrome.scripting.executeScript`
  and serialized one-by-one — each MUST be fully self-contained (no shared scope).
- After edits: chrome://extensions → ↻ on the card, and reload the target page.

## Constraints
- No external libraries for the contrast math (hand-rolled WCAG luminance).
- All code comments in English.
- The popup UI must itself pass WCAG 2.1 AA — verify every colour pair
  (≥4.5:1 text, ≥3:1 non-text) in both light and dark themes.

## Brand
conlaccento green `#41B493` (logo) is too light for text (~2.5:1). UI text/buttons
use darkened `#1f7a5c`; dark-theme links use `#41B493`; the icon uses the brand gradient.

## Publishing (Chrome Web Store)
Dashboard copy in `store/listing.md`, privacy policy `PRIVACY.md`, screenshot
backdrop `demo/index.html`. Package with `npm run package`. Only `debugger` needs
justifying in review — the extension uses `activeTab`, not `<all_urls>`.
