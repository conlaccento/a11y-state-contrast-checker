# Chrome Web Store — listing copy & review answers

Copy-paste reference for the Web Store Developer Dashboard. Not shipped in the
extension package. Each value below is in a code block so it copies cleanly
(paragraphs are single lines — the store textarea wraps them for you).

---

## Store listing

**Name**

```
A11y State Contrast Checker
```

**Summary** (short description, max 132 characters)

```
Audit WCAG colour contrast of :hover, :focus and :focus-visible states — the violations axe, Lighthouse and WAVE miss.
```

**Category**: Developer Tools · **Language**: English

**Detailed description**

```
Automated accessibility tools such as axe-core, Lighthouse and WAVE only check colour contrast on the page's resting state. They miss contrast failures that appear only when an element is hovered or focused — a faint hover text colour, a near-invisible focus ring, an icon that washes out on hover.

A11y State Contrast Checker fills that gap. It uses the Chrome DevTools Protocol to force the real :hover, :focus and :focus-visible states on the page's rendering engine, then measures the resulting contrast — so specificity, !important, custom properties and media queries are all resolved correctly by the browser itself.

What it checks:
• 1.4.3 Contrast (Minimum) — text vs. background on hover/focus
• 1.4.11 Non-text Contrast — the focus ring vs. its surroundings
• 1.4.11 — icon-only controls (SVG fill/stroke) vs. background

How to use it: open any page, click the icon, press "Run audit". Results show the element, the state, the measured ratio, the required ratio and pass/fail. Click a result to highlight that element on the page.

Note: while a scan runs, Chrome shows its "started debugging this browser" bar — that is how the extension forces the interactive states via the DevTools protocol, and it disappears when the scan ends.

Privacy: the extension collects no data and makes no network requests — everything runs locally. It is fully open source: https://github.com/conlaccento/a11y-state-contrast-checker
```

---

## Privacy practices tab

**Single purpose**

```
The single purpose of this extension is to audit WCAG colour contrast of interactive states (:hover, :focus, :focus-visible) on the current page, on demand.
```

**Permission justification — `debugger`**

```
The extension's core function is to measure contrast in real interactive states. It uses the DevTools Protocol (CSS.forcePseudoState) to force :hover / :focus / :focus-visible on the page, which no other extension API can do. It reads only style information; it does not capture or transmit page content.
```

**Permission justification — `activeTab`**

```
Grants temporary access to the single tab the user chooses to audit, only after they invoke the extension, so it can read that page's computed styles. Avoids requesting broad host access.
```

**Permission justification — `scripting`**

```
Injects a small function into the audited tab to read getComputedStyle() for the contrast calculation and to highlight the corresponding element when the user clicks a result row.
```

**Host permission justification**

```
None requested. The extension relies on activeTab instead of broad host permissions.
```

**Remote code**: No — all logic ships in the package; no remotely hosted code.

**Data usage**: certify that the extension does **not** collect or use any user
data; no data sold or transferred; no use unrelated to the single purpose.

**Privacy policy URL**

```
https://github.com/conlaccento/a11y-state-contrast-checker/blob/main/PRIVACY.md
```

---

## Screenshots

`store/a11y-state-contrast-checker-screenshot.png` (1280×800) — the popup open
over the demo page (`demo/index.html`), failures at the top.

Capture tips:
- Serve the demo over http so the audit runs without enabling file access:
  `python3 -m http.server 8000` in the repo root, then open
  `http://localhost:8000/demo/`.
- Hide the bookmarks bar (Cmd+Shift+B). To keep the popup from closing while you
  screenshot: right-click inside it → Inspect, then capture the window.
