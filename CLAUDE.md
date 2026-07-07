# A11y State Contrast Checker

Chrome MV3 extension: on-demand WCAG contrast audit of interactive states
(`:hover`/`:focus`/`:focus-visible`). Uses `chrome.debugger` (CDP) to force real
pseudo-classes, then `getComputedStyle` to measure. Not a git repo yet.

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

## Testing without loading the extension
Drive headless Chrome via raw CDP (Node 22 has a global `WebSocket`, no deps):
launch Chrome with `--headless=new --remote-debugging-port=PORT`, open
`test/fixture.html` (has 4 deliberate state-only violations), fetch the ws URL from
`http://127.0.0.1:PORT/json`, then send CDP commands.
