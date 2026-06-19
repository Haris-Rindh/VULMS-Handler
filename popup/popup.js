/**
 * popup.js — VU LMS Deadline Notifier popup controller.
 * Renders the item list, handles tab filtering, countdown updates, and user actions.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const LMS_BASE = 'https://vulms.vu.edu.pk';

const TYPE_ICONS = {
  assignment: '📝',
  quiz:       '📋',
  gdb:        '💬',
};

const TYPE_LABELS = {
  assignment: 'Assignment',
  quiz:       'Quiz',
  gdb:        'GDB',
};

// ─── State ────────────────────────────────────────────────────────────────────
let allItems       = [];
let activeFilter   = 'all';
let countdownTimer = null;

// ─── DOM References ───────────────────────────────────────────────────────────
const itemList     = document.getElementById('item-list');
const emptyState   = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const badgeCount   = document.getElementById('badge-count');
const lastChecked  = document.getElementById('last-checked');

// ─── Utility: Countdown ───────────────────────────────────────────────────────
function formatCountdown(deadlineISO) {
  const ms = new Date(deadlineISO).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function getUrgency(deadlineISO) {
  const h = (new Date(deadlineISO).getTime() - Date.now()) / 3600000;
  if (h <= 0)   return 'expired';
  if (h <= 6)   return 'critical';
  if (h <= 24)  return 'warn';
  return 'safe';
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-PK', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return iso; }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderItems() {
  // Clear existing cards (but not the state divs)
  document.querySelectorAll('.item-card').forEach(el => el.remove());

  const filtered = allItems.filter(item => {
    if (activeFilter === 'all') return true;
    return item.type === activeFilter;
  });

  // Sort: pending first by nearest deadline, then submitted/expired at bottom
  const sorted = [...filtered].sort((a, b) => {
    const aActive = a.status === 'pending';
    const bActive = b.status === 'pending';
    if (aActive !== bActive) return bActive ? 1 : -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });

  // Count active
  const activeCount = sorted.filter(i => i.status === 'pending' && getUrgency(i.deadline) !== 'expired').length;
  badgeCount.textContent = activeCount;
  badgeCount.classList.toggle('hidden', activeCount === 0);

  if (sorted.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  // Build cards
  sorted.forEach(item => {
    const urgency = item.status === 'submitted' ? 'safe' : getUrgency(item.deadline);
    const card = document.createElement('div');
    card.className = `item-card urgency-${urgency} status-${item.status}`;
    card.dataset.itemId = item.id;
    card.setAttribute('role', 'listitem');

    const countdownText = item.status === 'submitted'
      ? '✓ Submitted'
      : (item.status === 'expired' ? 'Expired' : formatCountdown(item.deadline));

    const isSubmitted = item.status === 'submitted';
    const isExpired   = item.status === 'expired' || getUrgency(item.deadline) === 'expired';

    card.innerHTML = `
      <div class="card-row-top">
        <span class="type-badge ${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
        <div class="card-meta">
          <div class="card-title" title="${escHtml(item.title)}">${escHtml(item.title)}</div>
          <div class="card-course">${escHtml(item.courseCode)} · Due: ${formatDate(item.deadline)}</div>
        </div>
      </div>
      <div class="card-row-bottom">
        <span class="countdown" data-deadline="${escHtml(item.deadline)}" data-status="${item.status}">${countdownText}</span>
        <div class="card-actions">
          <button class="btn-action open-lms" data-url="${escHtml(item.url || LMS_BASE)}" title="Open on LMS">↗ Open</button>
          ${!isSubmitted && !isExpired
            ? `<button class="btn-action btn-submit" data-id="${escHtml(item.id)}" title="Mark as submitted">✓ Submitted</button>`
            : ''}
          ${isSubmitted || isExpired
            ? `<button class="btn-action btn-dismiss" data-id="${escHtml(item.id)}" title="Dismiss">✕ Dismiss</button>`
            : ''}
        </div>
      </div>
    `;

    itemList.appendChild(card);
  });

  attachCardListeners();
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Live Countdown Updater ───────────────────────────────────────────────────
function startCountdowns() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    document.querySelectorAll('.countdown[data-deadline]').forEach(el => {
      const status = el.dataset.status;
      if (status === 'submitted') return;
      const deadline = el.dataset.deadline;
      const urgency  = getUrgency(deadline);
      el.textContent = formatCountdown(deadline);

      // Update card urgency class dynamically
      const card = el.closest('.item-card');
      if (card && status === 'pending') {
        card.className = card.className.replace(/urgency-\w+/, `urgency-${urgency}`);
      }
    });
  }, 1000);
}

// ─── Card Action Listeners ────────────────────────────────────────────────────
function attachCardListeners() {
  // Open LMS
  document.querySelectorAll('.btn-action.open-lms').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: btn.dataset.url || LMS_BASE });
    });
  });

  // Mark submitted
  document.querySelectorAll('.btn-submit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = '⏳';
      await chrome.runtime.sendMessage({ type: 'MARK_SUBMITTED', itemId: id });
      await loadAndRender();
    });
  });

  // Dismiss
  document.querySelectorAll('.btn-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await chrome.runtime.sendMessage({ type: 'DISMISS_ITEM', itemId: id });
      await loadAndRender();
    });
  });
}

// ─── Load Storage & Render ────────────────────────────────────────────────────
async function loadAndRender() {
  try {
    const result = await chrome.storage.local.get(['items']);
    const raw    = result.items || {};
    allItems     = Object.values(raw);

    // Last checked = most recent firstSeenAt
    const timestamps = allItems.map(i => i.lastNotifiedAt || i.firstSeenAt).filter(Boolean);
    if (timestamps.length) {
      const latest = Math.max(...timestamps.map(t => new Date(t).getTime()));
      lastChecked.textContent = `Updated: ${new Date(latest).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`;
    }

    loadingState.style.display = 'none';
    renderItems();
    startCountdowns();
  } catch (err) {
    loadingState.querySelector('.empty-title').textContent = 'Error loading data';
    loadingState.querySelector('.empty-sub').textContent   = err.message;
  }
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    activeFilter = tab.dataset.filter;
    renderItems();
  });
});

// ─── Buttons ─────────────────────────────────────────────────────────────────
document.getElementById('btn-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-open-lms').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: LMS_BASE });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadAndRender();
