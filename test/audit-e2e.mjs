// End-to-end regression test for the audit core.
//
// Drives a headless Chrome via the raw DevTools Protocol (no dependencies —
// Node 21+ ships a global WebSocket) and runs the exact flow background.js uses:
// tag candidates -> detect states by forcing pseudo-classes -> measure contrast
// with the real page-functions.js. Asserts that test/fixture.html produces the
// four deliberate failures and that the passing controls pass.
//
// Usage:  node test/audit-e2e.mjs
// Chrome: auto-detected on macOS/Linux, or set CHROME=/path/to/chrome
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 9339;

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => existsSync(p));
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('Chrome not found. Set CHROME=/path/to/chrome and retry.');
  process.exit(2);
}

// Load the real injected functions.
const src = readFileSync(path.join(ROOT, 'page-functions.js'), 'utf8');
// eslint-disable-next-line no-eval
const { tagCandidates, measureContrast } = (0, eval)(
  src + '\n;({ tagCandidates, measureContrast });'
);

// Mirror of background.js detectStates / forcedClassesFor.
function detectStates(matched) {
  const states = new Set();
  for (const m of matched.matchedCSSRules || []) {
    if (m.rule.origin === 'user-agent') continue;
    for (const sel of m.rule.selectorList?.selectors || []) {
      const t = sel.text || '';
      if (t.includes(':hover')) states.add('hover');
      if (t.includes(':focus-visible')) states.add('focus-visible');
      else if (t.includes(':focus')) states.add('focus');
    }
  }
  return [...states];
}
const forcedClassesFor = (s) =>
  s === 'focus-visible' ? ['focus', 'focus-visible'] : [s];

const userDataDir = mkdtempSync(path.join(tmpdir(), 'a11y-scc-test-'));
const proc = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userDataDir}`,
  'file://' + path.join(ROOT, 'test/fixture.html'),
]);

let ws;
try {
  await sleep(1500);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let idc = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++idc;
      pending.set(id, (m) =>
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  async function evalInPage(fn, ...args) {
    const argStr = args.map((a) => JSON.stringify(a)).join(',');
    const res = await cmd('Runtime.evaluate', {
      expression: `(${fn.toString()})(${argStr})`,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result.value;
  }

  await cmd('DOM.enable');
  await cmd('CSS.enable');

  const candidates = await evalInPage(tagCandidates);
  const { root } = await cmd('DOM.getDocument', { depth: -1, pierce: true });
  const nodeMap = new Map();
  (function walk(node) {
    const a = node.attributes;
    if (a)
      for (let i = 0; i < a.length; i += 2)
        if (a[i] === 'data-a11y-scc-id') nodeMap.set(a[i + 1], node.nodeId);
    (node.children || []).forEach(walk);
    (node.shadowRoots || []).forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
  })(root);

  const rows = [];
  for (const cand of candidates) {
    const nodeId = nodeMap.get(String(cand.id));
    if (!nodeId) continue;
    await cmd('CSS.forcePseudoState', {
      nodeId,
      forcedPseudoClasses: ['hover', 'focus', 'focus-visible'],
    });
    const matched = await cmd('CSS.getMatchedStylesForNode', { nodeId });
    const states = detectStates(matched);
    await cmd('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    for (const state of states) {
      await cmd('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: forcedClassesFor(state),
      });
      const findings = await evalInPage(measureContrast, cand.id, state);
      for (const f of findings) rows.push({ ...f, selector: cand.selector });
      await cmd('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    }
  }

  // --- Assertions ---
  const fails = rows.filter((r) => !r.pass);
  const has = (cls, pass) =>
    rows.some((r) => r.selector.includes(cls) && r.pass === pass);

  const checks = [
    ['.bad-hover fails on :hover', has('bad-hover', false)],
    ['.bad-focus fails on :focus', has('bad-focus', false)],
    ['.bad-ring focus ring fails', has('bad-ring', false)],
    ['.icon-btn icon fails on :hover', has('icon-btn', false)],
    ['.good passes on :hover', has('good', true) && !has('good', false)],
    ['.good-ring passes', has('good-ring', true) && !has('good-ring', false)],
    ['exactly 4 failures', fails.length === 4],
  ];

  let ok = true;
  console.log(`\nAudit produced ${rows.length} findings, ${fails.length} failing.\n`);
  for (const [name, pass] of checks) {
    console.log(`${pass ? '  ✓' : '  ✗ FAIL:'} ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nPASS ✅' : '\nFAILURES ❌');
  ws.close();
  proc.kill();
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('Test error:', err.message);
  if (ws) ws.close();
  proc.kill();
  process.exit(1);
}
