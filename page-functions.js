// Functions injected into the inspected page via chrome.scripting.executeScript.
//
// IMPORTANT: each of these functions is serialized on its own (Chrome sends
// `func.toString()` to the page), so every function MUST be fully self-contained.
// No shared module-scope helpers, no closures over the service worker — all
// helpers a function needs are declared inside its own body.

// Phase 1: find candidate interactive elements (piercing shadow roots), tag each
// with a stable data-a11y-scc-id so the service worker can locate the matching
// CDP node later, and return a lightweight descriptor list for the popup.
function tagCandidates() {
  const CANDIDATE_SELECTOR =
    'a, button, input, select, textarea, [role="button"], [tabindex]';
  const ATTR = 'data-a11y-scc-id';

  // Build a reasonably unique, human-readable CSS path for display purposes.
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      let sel = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) {
        sel +=
          '.' +
          Array.from(node.classList)
            .slice(0, 2)
            .map((c) => CSS.escape(c))
            .join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.nodeName === node.nodeName
        );
        if (sameTag.length > 1) {
          sel += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  const results = [];
  let counter = 0;

  // Recursively collect candidates from a root (document or shadow root),
  // then descend into any nested shadow roots.
  function collect(root) {
    let nodes;
    try {
      nodes = root.querySelectorAll(CANDIDATE_SELECTOR);
    } catch (e) {
      nodes = [];
    }
    nodes.forEach((el) => {
      el.setAttribute(ATTR, String(counter));
      results.push({
        id: counter,
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
      });
      counter++;
    });
    // Descend into shadow roots.
    const all = root.querySelectorAll('*');
    all.forEach((el) => {
      if (el.shadowRoot) collect(el.shadowRoot);
    });
  }

  // Remove tags from any previous run first so ids stay in sync.
  document.querySelectorAll('[' + ATTR + ']').forEach((el) => {
    el.removeAttribute(ATTR);
  });
  collect(document);
  return results;
}

// Phase 3: measure contrast for a single element in a single forced state.
// `forcedState` is one of 'hover' | 'focus' | 'focus-visible'. The CDP side has
// already forced the corresponding pseudo-class before calling this, so
// getComputedStyle() below reflects the real state styles resolved by the engine.
// Returns an array of findings (text contrast, focus-ring contrast, icon contrast).
function measureContrast(id, forcedState) {
  const ATTR = 'data-a11y-scc-id';

  // Deep query across shadow roots for the tagged element.
  function deepFind(sel) {
    function search(root) {
      const found = root.querySelector(sel);
      if (found) return found;
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const r = search(el.shadowRoot);
          if (r) return r;
        }
      }
      return null;
    }
    return search(document);
  }

  // Parse a computed color string into {r,g,b,a} (0-255 channels, 0-1 alpha).
  // Handles rgb()/rgba() legacy and space-separated modern syntaxes.
  function parseColor(str) {
    if (!str) return null;
    str = str.trim();
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const m = str.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(/[,\/\s]+/).filter((p) => p.length);
      if (parts.length < 3) return null;
      const chan = (v) =>
        v.indexOf('%') >= 0
          ? Math.round((parseFloat(v) / 100) * 255)
          : parseFloat(v);
      const r = chan(parts[0]);
      const g = chan(parts[1]);
      const b = chan(parts[2]);
      let a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      if (parts[3] && parts[3].indexOf('%') >= 0) a = parseFloat(parts[3]) / 100;
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return { r, g, b, a: Number.isNaN(a) ? 1 : a };
    }
    return null;
  }

  // Composite `top` (with alpha) over opaque `bottom`. Returns opaque color.
  function blend(top, bottom) {
    const a = top.a;
    return {
      r: Math.round(top.r * a + bottom.r * (1 - a)),
      g: Math.round(top.g * a + bottom.g * (1 - a)),
      b: Math.round(top.b * a + bottom.b * (1 - a)),
      a: 1,
    };
  }

  // Walk up the ancestor chain (crossing shadow host boundaries) collecting
  // non-transparent background layers, then composite over white.
  function resolveBackground(startEl) {
    const layers = [];
    let node = startEl;
    while (node && node.nodeType === 1) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (node.parentElement) {
        node = node.parentElement;
      } else {
        const rootNode = node.getRootNode();
        node = rootNode && rootNode.host ? rootNode.host : null;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    // layers[0] is closest to the element (drawn on top); composite bottom-up.
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  }

  function relLuminance(c) {
    const f = (v) => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(c1, c2) {
    const l1 = relLuminance(c1);
    const l2 = relLuminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  const el = deepFind('[' + ATTR + '="' + id + '"]');
  if (!el) return [];

  const cs = getComputedStyle(el);
  const findings = [];
  const bg = resolveBackground(el);

  // --- 1.4.3 Contrast (Minimum): text vs background ---
  const hasVisibleText = (el.textContent || '').trim().length > 0;
  if (hasVisibleText) {
    let fg = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
    if (fg.a < 1) fg = blend(fg, bg); // composite semi-transparent text over bg
    const fontSize = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    // WCAG large text: >= 24px, or >= 18.66px when bold (>= 700).
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const threshold = isLarge ? 3 : 4.5;
    const ratio = contrastRatio(fg, bg);
    findings.push({
      id,
      state: forcedState,
      check: '1.4.3',
      type: 'text',
      fg: 'rgb(' + fg.r + ', ' + fg.g + ', ' + fg.b + ')',
      bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
      ratio: round2(ratio),
      threshold,
      pass: ratio >= threshold - 0.005,
      note: isLarge ? 'large text' : '',
    });
  }

  // --- 1.4.11 Non-text Contrast: focus ring (only in focus states) ---
  if (forcedState === 'focus' || forcedState === 'focus-visible') {
    const surrounding = resolveBackground(el.parentElement || el);
    let ringColor = null;
    let ringSource = '';

    const outlineStyle = cs.outlineStyle;
    const outlineWidth = parseFloat(cs.outlineWidth) || 0;
    if (outlineStyle !== 'none' && outlineWidth > 0) {
      ringColor = parseColor(cs.outlineColor);
      ringSource = 'outline';
    }
    // Fall back to box-shadow used as a focus ring.
    if (!ringColor || ringColor.a === 0) {
      const shadow = cs.boxShadow;
      if (shadow && shadow !== 'none') {
        const m = shadow.match(/rgba?\([^)]+\)/i);
        if (m) {
          ringColor = parseColor(m[0]);
          ringSource = 'box-shadow';
        }
      }
    }

    if (ringColor && ringColor.a > 0) {
      let ring = ringColor;
      if (ring.a < 1) ring = blend(ring, surrounding);
      const ratio = contrastRatio(ring, surrounding);
      findings.push({
        id,
        state: forcedState,
        check: '1.4.11',
        type: 'focus-ring',
        fg: 'rgb(' + ring.r + ', ' + ring.g + ', ' + ring.b + ')',
        bg:
          'rgb(' +
          surrounding.r +
          ', ' +
          surrounding.g +
          ', ' +
          surrounding.b +
          ')',
        ratio: round2(ratio),
        threshold: 3,
        pass: ratio >= 3 - 0.005,
        note: ringSource,
      });
    }
  }

  // --- 1.4.11 Non-text Contrast: icon-only controls (SVG fill/stroke) ---
  if (!hasVisibleText) {
    const svg = el.querySelector('svg');
    if (svg) {
      const scs = getComputedStyle(svg);
      // Prefer the SVG's own fill; if 'none', check a child path/shape.
      let paintStr = scs.fill;
      let target = svg;
      if (!paintStr || paintStr === 'none' || paintStr === 'rgba(0, 0, 0, 0)') {
        const shape = svg.querySelector(
          'path, circle, rect, polygon, line, ellipse'
        );
        if (shape) {
          const shcs = getComputedStyle(shape);
          paintStr =
            shcs.fill && shcs.fill !== 'none' ? shcs.fill : shcs.stroke;
          target = shape;
        }
      }
      if (!paintStr || paintStr === 'none') {
        paintStr = scs.stroke;
      }
      const paint = parseColor(paintStr);
      if (paint && paint.a > 0) {
        let p = paint;
        if (p.a < 1) p = blend(p, bg);
        const ratio = contrastRatio(p, bg);
        findings.push({
          id,
          state: forcedState,
          check: '1.4.11',
          type: 'icon',
          fg: 'rgb(' + p.r + ', ' + p.g + ', ' + p.b + ')',
          bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
          ratio: round2(ratio),
          threshold: 3,
          pass: ratio >= 3 - 0.005,
          note: 'icon',
        });
      }
    }
  }

  return findings;
}

// Scroll to and temporarily highlight the element with the given id, so the user
// can visually verify a finding from the results table.
function highlightElement(id) {
  const ATTR = 'data-a11y-scc-id';
  function deepFind(sel) {
    function search(root) {
      const found = root.querySelector(sel);
      if (found) return found;
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const r = search(el.shadowRoot);
          if (r) return r;
        }
      }
      return null;
    }
    return search(document);
  }
  const el = deepFind('[' + ATTR + '="' + id + '"]');
  if (!el) return false;
  const reduce =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = '3px solid #ff00ff';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }, 2000);
  return true;
}
