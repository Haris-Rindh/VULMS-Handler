/**
 * content.js — Runs on VU LMS pages.
 * Parses the DOM for assignments/quizzes/GDBs and reports to background.js.
 * Uses MutationObserver to handle AJAX-loaded content.
 */

(function () {
  'use strict';

  let debounceTimer = null;
  let lastSentHash  = '';

  // ─── Debounced Scan ─────────────────────────────────────────────────────────
  function scheduleScan(delay = 1200) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runScan, delay);
  }

  // ─── Main Scan ──────────────────────────────────────────────────────────────
  async function runScan() {
    try {
      // Load custom selectors from storage
      let customSelectors = null;
      try {
        const result = await chrome.storage.local.get(['settings']);
        customSelectors = result?.settings?.customSelectors || null;
      } catch (_) { /* storage unavailable on first load */ }

      // Parse the current page (parser.js is injected before content.js)
      const items = parseLMSPage(document, customSelectors);

      if (items.length === 0) return;

      // Deduplicate sends: skip if same data was sent recently
      const hash = JSON.stringify(items.map(i => i.id + i.status));
      if (hash === lastSentHash) return;
      lastSentHash = hash;

      // Send to background service worker
      chrome.runtime.sendMessage({ type: 'LMS_SCAN_RESULT', items }, (response) => {
        if (chrome.runtime.lastError) {
          // Background worker may have been restarted — safe to ignore
          console.debug('[VU Notifier] background not reachable:', chrome.runtime.lastError.message);
        }
      });
    } catch (err) {
      console.error('[VU Notifier] content scan error:', err);
    }
  }

  // ─── MutationObserver ───────────────────────────────────────────────────────
  // Watch for AJAX-injected tables (VU LMS often loads content dynamically)
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === Node.ELEMENT_NODE &&
        (n.tagName === 'TABLE' || n.tagName === 'TR' || n.tagName === 'TD' ||
         n.querySelector?.('table, tr, td, a'))
      )
    );
    if (relevant) scheduleScan(800);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Initial Scan ───────────────────────────────────────────────────────────
  // Run immediately on document_idle, then again after a short delay in case
  // of deferred JS that populates the table after DOM ready
  scheduleScan(500);
  scheduleScan(3000);

})();
