// Service worker: orchestrates the audit using the Chrome DevTools Protocol
// (via chrome.debugger) to force real pseudo-classes on the render engine, plus
// chrome.scripting to measure the resulting computed styles in the page.

importScripts('page-functions.js');

const CDP_VERSION = '1.3';
const MAX_ELEMENTS = 500; // safety cap on candidates scanned
const MAX_TIME_MS = 30000; // safety cap on total scan time

// In-memory audit state, surfaced to the popup on demand (survives popup close
// for the lifetime of the service worker).
let auditState = {
  status: 'idle', // 'idle' | 'running' | 'done' | 'error'
  tabId: null,
  current: 0,
  total: 0,
  rows: [],
  partial: false,
  error: null,
};

// Cooperative cancellation: bumped whenever we want a running scan to stop
// (e.g. the user detaches the debugger via Chrome's yellow bar).
let runToken = 0;

function resetState(tabId) {
  auditState = {
    status: 'running',
    tabId,
    current: 0,
    total: 0,
    rows: [],
    partial: false,
    error: null,
  };
}

function broadcast() {
  // Notify the popup if it is open; ignore "no receiver" errors when it is not.
  chrome.runtime.sendMessage({ type: 'auditState', state: auditState }).catch(() => {});
}

// --- chrome.debugger promise wrappers -------------------------------------

function dbgAttach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, CDP_VERSION, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function dbgDetach(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      // Swallow errors: the target may already be gone.
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function sendCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params || {}, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

// If the user clicks "Cancel" on Chrome's debugging bar, the debugger detaches;
// abort any in-flight scan so we stop issuing commands against a dead session.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (auditState.status === 'running' && source.tabId === auditState.tabId) {
    runToken++;
    auditState.status = 'done';
    auditState.partial = true;
    auditState.error =
      reason === 'canceled_by_user'
        ? 'Debugger detached (you clicked "Cancel" on the debugging bar). Showing partial results.'
        : 'Debugger detached unexpectedly. Showing partial results.';
    broadcast();
  }
});

// --- Helpers ---------------------------------------------------------------

// Recursively walk a DOM.getDocument tree (pierced through shadow roots and
// iframes) building a map from our data-a11y-scc-id attribute value -> nodeId.
function buildNodeIdMap(node, map) {
  const attrs = node.attributes;
  if (attrs) {
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'data-a11y-scc-id') {
        map.set(attrs[i + 1], node.nodeId);
      }
    }
  }
  (node.children || []).forEach((c) => buildNodeIdMap(c, map));
  (node.shadowRoots || []).forEach((c) => buildNodeIdMap(c, map));
  if (node.contentDocument) buildNodeIdMap(node.contentDocument, map);
}

// Inspect matched CSS rules for a node and return which interactive states have
// dedicated style rules. Distinguishes :focus-visible from plain :focus so we
// force exactly the pseudo-class the author targeted.
//
// NOTE: resting getMatchedStylesForNode does NOT include pseudo-class rules, so
// callers must force the states first (see runAudit). We also ignore user-agent
// rules (the browser's default `:focus-visible { outline: auto }` would
// otherwise flag every focusable element).
function detectStates(matchedStyles) {
  const states = new Set();
  const rules = matchedStyles.matchedCSSRules || [];
  for (const match of rules) {
    if (match.rule.origin === 'user-agent') continue; // author styles only
    const selectors = (match.rule.selectorList && match.rule.selectorList.selectors) || [];
    for (const sel of selectors) {
      const text = sel.text || '';
      if (text.includes(':hover')) states.add('hover');
      if (text.includes(':focus-visible')) {
        states.add('focus-visible');
      } else if (text.includes(':focus')) {
        states.add('focus');
      }
    }
  }
  return Array.from(states);
}

// Map a detected state to the set of forced pseudo-classes CDP should apply.
// :focus-visible normally also requires :focus, so force both together.
function forcedClassesFor(state) {
  if (state === 'focus-visible') return ['focus', 'focus-visible'];
  return [state];
}

// --- Main audit flow -------------------------------------------------------

async function runAudit(tabId) {
  const myToken = ++runToken;
  resetState(tabId);
  broadcast();

  const target = { tabId };

  try {
    await dbgAttach(target);
  } catch (err) {
    // Most common cause: DevTools is open on this tab, or another extension
    // already holds the debugger.
    auditState.status = 'error';
    auditState.error =
      'Could not attach the debugger. Close DevTools (or any other debugging ' +
      'tool) on this tab and try again.\n\nDetails: ' +
      err.message;
    broadcast();
    return;
  }

  const startTime = Date.now();

  try {
    await sendCommand(target, 'DOM.enable');
    await sendCommand(target, 'CSS.enable');

    // Phase 1: tag candidate elements in the page.
    const tagResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: tagCandidates,
    });
    let candidates = (tagResults && tagResults[0] && tagResults[0].result) || [];

    if (candidates.length > MAX_ELEMENTS) {
      candidates = candidates.slice(0, MAX_ELEMENTS);
      auditState.partial = true;
    }
    auditState.total = candidates.length;
    broadcast();

    // Phase 2: resolve CDP nodeIds for the tagged elements (shadow-piercing).
    const doc = await sendCommand(target, 'DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    const nodeMap = new Map();
    buildNodeIdMap(doc.root, nodeMap);

    // Phase 3: for each candidate with state rules, force each state and measure.
    for (let i = 0; i < candidates.length; i++) {
      if (myToken !== runToken) return; // canceled / superseded

      if (Date.now() - startTime > MAX_TIME_MS) {
        auditState.partial = true;
        break;
      }

      auditState.current = i + 1;
      broadcast();

      const cand = candidates[i];
      const nodeId = nodeMap.get(String(cand.id));
      if (!nodeId) continue;

      // Detect which interactive states have author style rules. Resting matched
      // styles never include pseudo-class rules, so we force all three states at
      // once and read which pseudo selectors then resolve as matching. This is
      // also cross-origin-safe (unlike an in-page CSSOM scan, which CORS blocks).
      let states = [];
      try {
        await sendCommand(target, 'CSS.forcePseudoState', {
          nodeId,
          forcedPseudoClasses: ['hover', 'focus', 'focus-visible'],
        });
        const matched = await sendCommand(target, 'CSS.getMatchedStylesForNode', {
          nodeId,
        });
        states = detectStates(matched);
      } catch (e) {
        continue; // node may have detached mid-scan
      } finally {
        await sendCommand(target, 'CSS.forcePseudoState', {
          nodeId,
          forcedPseudoClasses: [],
        }).catch(() => {});
      }

      if (!states.length) continue; // skip elements with no state rules

      for (const state of states) {
        if (myToken !== runToken) return;

        try {
          await sendCommand(target, 'CSS.forcePseudoState', {
            nodeId,
            forcedPseudoClasses: forcedClassesFor(state),
          });

          const measured = await chrome.scripting.executeScript({
            target: { tabId },
            func: measureContrast,
            args: [cand.id, state],
          });
          const findings = (measured && measured[0] && measured[0].result) || [];
          for (const f of findings) {
            auditState.rows.push({ ...f, selector: cand.selector, tag: cand.tag });
          }
        } catch (e) {
          // Ignore per-element failures; keep scanning.
        } finally {
          // Reset the forced state before moving on.
          await sendCommand(target, 'CSS.forcePseudoState', {
            nodeId,
            forcedPseudoClasses: [],
          }).catch(() => {});
        }
      }
    }

    if (myToken === runToken) {
      auditState.status = 'done';
      broadcast();
    }
  } catch (err) {
    auditState.status = 'error';
    auditState.error = 'Audit failed: ' + err.message;
    broadcast();
  } finally {
    await dbgDetach(target);
  }
}

// --- Messaging -------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'runAudit') {
    runAudit(msg.tabId);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'getState') {
    sendResponse({ state: auditState });
    return false;
  }
  if (msg.type === 'highlight') {
    chrome.scripting
      .executeScript({
        target: { tabId: msg.tabId },
        func: highlightElement,
        args: [msg.elementId],
      })
      .catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
