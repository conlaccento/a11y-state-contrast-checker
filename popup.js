// Popup: triggers the audit, renders progress and results, and asks the
// background worker to highlight an element when a result row is clicked.

const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const liveEl = document.getElementById('live');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const errorEl = document.getElementById('error');
const summaryEl = document.getElementById('summary');
const table = document.getElementById('results');
const tbody = document.getElementById('results-body');
const emptyEl = document.getElementById('empty');

let activeTabId = null;
let lastStatus = null; // for milestone announcements on status transitions

// Announce a single milestone in the polite live region. Clearing first forces
// assistive tech to re-read even if the text repeats.
function announce(msg) {
  liveEl.textContent = '';
  window.setTimeout(() => {
    liveEl.textContent = msg;
  }, 50);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function render(state) {
  // Status line + progress bar. The visible counter is NOT a live region;
  // milestone announcements are handled separately below to avoid flooding.
  if (state.status === 'running') {
    runBtn.disabled = true;
    statusEl.textContent =
      state.total > 0
        ? `Scanning ${state.current}/${state.total} elements…`
        : 'Preparing…';
    progressWrap.hidden = false;
    setProgress(state.total > 0 ? (state.current / state.total) * 100 : 0);
  } else {
    runBtn.disabled = false;
    if (state.status === 'done') statusEl.textContent = 'Done.';
    else if (state.status === 'error') statusEl.textContent = 'Error.';
    else statusEl.textContent = '';
    if (state.status !== 'running') progressWrap.hidden = state.status !== 'done';
    if (state.status === 'done') setProgress(100);
  }

  // Milestone announcements, only on a status transition.
  if (state.status !== lastStatus) {
    if (state.status === 'running') {
      announce('Audit started.');
    } else if (state.status === 'done') {
      const fails = (state.rows || []).filter((r) => !r.pass).length;
      announce(
        `Audit complete. ${(state.rows || []).length} checks, ${fails} failed.` +
          (state.partial ? ' Partial results.' : '')
      );
    } else if (state.status === 'error') {
      announce('Audit failed. ' + (state.error || ''));
    }
    lastStatus = state.status;
  }

  // Error box.
  if (state.status === 'error' && state.error) {
    errorEl.hidden = false;
    errorEl.textContent = state.error;
  } else {
    errorEl.hidden = true;
  }

  // Results (render once the run is no longer active, or progressively).
  renderRows(state);
}

function renderRows(state) {
  const rows = state.rows || [];

  // Summary.
  if (state.status === 'done' || rows.length) {
    const fails = rows.filter((r) => !r.pass).length;
    const passes = rows.length - fails;
    let html = '';
    if (rows.length) {
      html =
        `<span class="s-fail">${fails} fail</span> · ` +
        `<span class="s-pass">${passes} pass</span> ` +
        `(${rows.length} checks)`;
    }
    if (state.partial) {
      html +=
        '<span class="s-partial">⚠️ Partial results: the scan hit a time or ' +
        'element limit, or was interrupted.</span>';
    }
    if (state.error && state.status !== 'error') {
      html += `<span class="s-partial">${escapeHtml(state.error)}</span>`;
    }
    summaryEl.innerHTML = html;
    summaryEl.hidden = !html;
  } else {
    summaryEl.hidden = true;
  }

  tbody.innerHTML = '';
  if (!rows.length) {
    table.hidden = true;
    emptyEl.hidden = !(state.status === 'done');
    return;
  }
  emptyEl.hidden = true;
  table.hidden = false;

  // Show failures first, then passes.
  const sorted = rows.slice().sort((a, b) => Number(a.pass) - Number(b.pass));
  for (const r of sorted) {
    const tr = document.createElement('tr');
    if (!r.pass) tr.className = 'row-fail';
    tr.innerHTML =
      `<td><button type="button" class="locate">${escapeHtml(
        r.selector
      )}</button></td>` +
      `<td>:${escapeHtml(r.state)}</td>` +
      `<td>${escapeHtml(r.check)}<span class="type-tag">${escapeHtml(
        r.type
      )}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span></td>` +
      `<td>${r.ratio.toFixed(2)}:1</td>` +
      `<td>${r.threshold}:1</td>` +
      `<td><span class="badge ${r.pass ? 'pass' : 'fail'}">${
        r.pass ? 'PASS' : 'FAIL'
      }</span></td>`;
    // The selector is a real button: keyboard-operable, with a descriptive
    // accessible name explaining what activating it does.
    const btn = tr.querySelector('.locate');
    btn.setAttribute(
      'aria-label',
      `Highlight ${r.selector} on the page (:${r.state}, ${
        r.pass ? 'pass' : 'fail'
      })`
    );
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'highlight',
        tabId: activeTabId,
        elementId: r.id,
      });
    });
    tbody.appendChild(tr);
  }
}

runBtn.addEventListener('click', async () => {
  errorEl.hidden = true;
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  activeTabId = tab.id;
  // Guard against restricted pages where scripting/debugger cannot attach.
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '')) {
    errorEl.hidden = false;
    errorEl.textContent =
      'This page cannot be audited (browser-internal or extension page). ' +
      'Open a regular website and try again.';
    return;
  }
  chrome.runtime.sendMessage({ type: 'runAudit', tabId: tab.id });
});

// Live updates from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'auditState') {
    if (msg.state.tabId != null) activeTabId = msg.state.tabId;
    render(msg.state);
  }
});

// On open, restore any in-progress or finished state.
(async () => {
  const tab = await getActiveTab();
  if (tab && tab.id) activeTabId = tab.id;
  chrome.runtime.sendMessage({ type: 'getState' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.state) render(resp.state);
  });
})();
