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

## Pending improvements — from an external Playwright/CDP port (REMEMBER at session start)
The core logic (`page-functions.js` + `background.js` CDP orchestration) was ported
to a Playwright audit for another project (Teatro Ponchielli). Running it there
surfaced 4 fixes worth bringing back into this extension. They are validated in the
port; consider porting them here when next working on the extension.

1. **Dual-tone focus ring: measure ALL ring layers, pass if ANY clears 3:1.**
   `measureContrast` currently checks a single layer (`outline`, else falls back to
   `box-shadow`). A dual-tone ring (light outline + dark box-shadow halo) is designed
   so at least one layer contrasts on any background; the single-layer check fails a
   white outline over a white page even though the dark halo is the visible edge.
   Fix: collect the outline colour AND every `rgba()` in `box-shadow` (it can hold
   several shadows), evaluate each vs the surrounding, report the best-contrasting one.

2. **Kill transitions/animations before measuring.** After `CSS.forcePseudoState`,
   `getComputedStyle` can read values MID-transition (e.g. outline animating 3px→2px,
   box-shadow fading in over 0.2s) → wrong/unstable ratios. In the extension the
   `chrome.scripting` round-trip usually outlasts the transition and masks this, but
   it is not robust. Fix: inject `*,*::before,*::after{transition:none!important;
   animation:none!important;}` at scan start (a `<style>` via `chrome.scripting`).

3. **Skip sr-only text (like axe).** `hasVisibleText = textContent.trim().length>0`
   counts visually-hidden labels (`.screen-reader-text`, `.menu-image-title-hide`:
   clip rect / clip-path inset / 1px clipped box), giving false 1.4.3 fails on
   icon-only controls. Fix: only treat text as visible if a text node is NOT inside a
   visually-hidden subtree (walk text nodes, check the sr-only signature up to the el).

4. **Skip non-perceivable elements.** Controls with `getClientRects().length === 0`
   (a `display:none` ancestor — e.g. collapsed mega-menu/sub-menu links) OR
   `getComputedStyle(el).visibility === 'hidden'|'collapse'` (a flyout hidden until
   opened) cannot be audited in isolation: forcing `:hover` on the leaf does not
   reveal its panel, so the background resolves to whatever is behind it and
   text≈background gives a bogus ~1:1 fail. Fix, early in `measureContrast`:
   `const cs = getComputedStyle(el); if (!el.getClientRects().length || cs.visibility === 'hidden' || cs.visibility === 'collapse') return [];`
   (visibility:hidden keeps rects, so check it separately). CAVEAT: if the flyout is
   actually open on focus (as the WPML language switcher was in the Ponchielli
   project — white text on a #eee background, ~1.16:1), the finding is REAL — do not
   skip just because "it's a dropdown"; skip only when the element is genuinely hidden.

Reference implementation with full comments: the port's `state-contrast.js` and
`state-contrast-notes.md` under the Ponchielli project's `a11y-tooling/` (outside this
repo: `~/Job/BS/teatro ponchielli/a11y-tooling/`).
