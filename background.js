/**
 * background.js — Service Worker for VU LMS Deadline Notifier.
 *
 * Responsibilities:
 *  - Receive LMS_SCAN_RESULT from content.js → diff against storage → notify
 *  - Set up periodic chrome.alarms for escalating re-notification
 *  - Handle MARK_SUBMITTED messages from popup.js
 *  - Open relevant LMS URL when a notification is clicked
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const ALARM_NAME       = 'lmsCheckAlarm';
const DEFAULT_INTERVAL = 30; // minutes
const LMS_BASE_URL     = 'https://vulms.vu.edu.pk';
const OFFSCREEN_PATH   = 'utils/audio.html';

// ─── Default Settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  preset:           'normal',
  checkInterval:    DEFAULT_INTERVAL,
  quietHoursStart:  '23:00',
  quietHoursEnd:    '07:00',
  soundEnabled:     true,
  customSelectors:  null,
};

// ─── Scheduler helpers (inlined; can't import in service workers easily) ──────
const PRESETS = {
  normal: {
    moreThan72h:      24 * 60 * 60 * 1000,
    between24and72h:   6 * 60 * 60 * 1000,
    between6and24h:    2 * 60 * 60 * 1000,
    lessThan6h:       30 * 60 * 1000,
  },
  aggressive: {
    moreThan72h:      12 * 60 * 60 * 1000,
    between24and72h:   3 * 60 * 60 * 1000,
    between6and24h:    1 * 60 * 60 * 1000,
    lessThan6h:       15 * 60 * 1000,
  }
};

function getInterval(deadline, now, preset) {
  const ms = deadline - now;
  if (ms <= 0) return null;
  const h = ms / 3600000;
  const p = PRESETS[preset] || PRESETS.normal;
  if (h > 72)  return p.moreThan72h;
  if (h > 24)  return p.between24and72h;
  if (h > 6)   return p.between6and24h;
  return p.lessThan6h;
}

function isInQuietHours(now, settings) {
  if (!settings?.quietHoursStart || !settings?.quietHoursEnd) return false;
  const [sh, sm] = settings.quietHoursStart.split(':').map(Number);
  const [eh, em] = settings.quietHoursEnd.split(':').map(Number);
  const d   = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const st  = sh * 60 + sm;
  const en  = eh * 60 + em;
  return st > en ? (cur >= st || cur < en) : (cur >= st && cur < en);
}

function formatCountdown(deadline, now) {
  const ms = deadline - now;
  if (ms <= 0) return 'Deadline passed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────
async function loadStorage() {
  const result = await chrome.storage.local.get(['items', 'settings']);
  return {
    items:    result.items    || {},
    settings: Object.assign({}, DEFAULT_SETTINGS, result.settings || {}),
  };
}

async function saveItems(items) {
  await chrome.storage.local.set({ items });
}

// ─── Notification Helpers ─────────────────────────────────────────────────────
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

function notificationId(itemId) {
  return `vu-notifier-${itemId}`;
}

async function fireNotification(item, isCritical, isExpired) {
  const deadline = new Date(item.deadline).getTime();
  const now      = Date.now();
  const icon     = TYPE_ICONS[item.type] || '📌';
  const label    = TYPE_LABELS[item.type] || 'Item';

  let title, message;

  if (isExpired) {
    title   = `❌ Missed ${label} — ${item.courseCode}`;
    message = `"${item.title}" deadline has passed without submission.`;
  } else if (isCritical) {
    title   = `🚨 URGENT — ${label} Due Soon! (${item.courseCode})`;
    message = `${icon} "${item.title}" — ${formatCountdown(deadline, now)}`;
  } else {
    title   = `⏰ ${label} Reminder — ${item.courseCode}`;
    message = `${icon} "${item.title}" — ${formatCountdown(deadline, now)}`;
  }

  const notifOptions = {
    type:             'basic',
    iconUrl:          chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    requireInteraction: isCritical || isExpired,
    silent:           !isCritical,
  };

  await chrome.notifications.create(notificationId(item.id), notifOptions);
}

// ─── Offscreen Audio ──────────────────────────────────────────────────────────
let offscreenCreated = false;

async function playAlertSound() {
  try {
    // Ensure only one offscreen document exists
    const existing = await chrome.offscreen.hasDocument?.();
    if (!existing && !offscreenCreated) {
      await chrome.offscreen.createDocument({
        url:    OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play deadline alert chime for critical notifications',
      });
      offscreenCreated = true;
    }
    await chrome.runtime.sendMessage({ type: 'PLAY_SOUND' });
  } catch (err) {
    // Offscreen API is optional — fail silently
    console.debug('[VU Notifier] audio error:', err.message);
  }
}

// ─── Core Diff & Notify Logic ─────────────────────────────────────────────────
async function processScannedItems(incomingItems) {
  const { items: stored, settings } = await loadStorage();
  const now = Date.now();

  for (const incoming of incomingItems) {
    const existing = stored[incoming.id];

    if (!existing) {
      // ── NEW ITEM ────────────────────────────────────────────────────────────
      // Don't notify about already-submitted items seen for the first time
      if (incoming.status === 'submitted') {
        stored[incoming.id] = {
          ...incoming,
          firstSeenAt:    new Date(now).toISOString(),
          lastNotifiedAt: null,
          notifyCount:    0,
        };
        continue;
      }

      stored[incoming.id] = {
        ...incoming,
        firstSeenAt:    new Date(now).toISOString(),
        lastNotifiedAt: new Date(now).toISOString(),
        notifyCount:    1,
      };

      const deadline = new Date(incoming.deadline).getTime();
      const hoursLeft = (deadline - now) / 3600000;
      const isCritical = hoursLeft > 0 && hoursLeft <= 6;

      await fireNotification(stored[incoming.id], isCritical, false);
      if (isCritical && settings.soundEnabled) await playAlertSound();

    } else if (existing.status === 'pending' && incoming.status === 'submitted') {
      // ── STATUS CHANGE → SUBMITTED ────────────────────────────────────────
      stored[incoming.id] = { ...existing, status: 'submitted' };
      // Clear any pending OS notification
      chrome.notifications.clear(notificationId(incoming.id)).catch(() => {});

    } else if (existing.status !== 'submitted' && existing.status !== 'expired') {
      // ── UPDATE EXISTING (freshen deadline/status if changed on LMS) ────────
      stored[incoming.id] = {
        ...existing,
        deadline: incoming.deadline,
        status:   incoming.status,
        url:      incoming.url || existing.url,
      };
    }
  }

  await saveItems(stored);
}

// ─── Alarm Handler: Re-check and Re-notify ───────────────────────────────────
async function runScheduledCheck() {
  const { items: stored, settings } = await loadStorage();
  const now = Date.now();
  let changed = false;

  for (const item of Object.values(stored)) {
    if (item.status === 'submitted' || item.status === 'expired') continue;

    const deadline  = new Date(item.deadline).getTime();
    const msLeft    = deadline - now;
    const hoursLeft = msLeft / 3600000;

    if (msLeft <= 0) {
      // ── EXPIRED ────────────────────────────────────────────────────────────
      if (item.status !== 'expired') {
        stored[item.id] = { ...item, status: 'expired' };
        changed = true;
        await fireNotification(stored[item.id], false, true);
      }
      continue;
    }

    // ── ESCALATION CHECK ─────────────────────────────────────────────────────
    const interval   = getInterval(deadline, now, settings.preset);
    const lastAt     = item.lastNotifiedAt ? new Date(item.lastNotifiedAt).getTime() : 0;
    const timeSince  = now - lastAt;
    const isCritical = hoursLeft <= 6;

    if (timeSince < interval) continue;
    if (hoursLeft > 6 && isInQuietHours(now, settings)) continue;

    // Fire notification
    await fireNotification(stored[item.id], isCritical, false);
    stored[item.id] = {
      ...stored[item.id],
      lastNotifiedAt: new Date(now).toISOString(),
      notifyCount:    (stored[item.id].notifyCount || 0) + 1,
    };
    changed = true;
    if (isCritical && settings.soundEnabled) await playAlertSound();
  }

  if (changed) await saveItems(stored);
}

// ─── Alarm Setup ──────────────────────────────────────────────────────────────
async function setupAlarm() {
  const { settings } = await loadStorage();
  const periodInMinutes = settings.checkInterval || DEFAULT_INTERVAL;

  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { periodInMinutes, delayInMinutes: periodInMinutes });
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// On install / update — set up alarm and default settings
chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await loadStorage();
  if (!settings || Object.keys(settings).length === 0 || details.reason === 'install') {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, items: {} });
  }
  await setupAlarm();

  if (details.reason === 'install') {
    chrome.notifications.create('vu-notifier-welcome', {
      type:    'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title:   '✅ VU LMS Deadline Notifier Installed!',
      message: 'Visit any VULMS page while logged in and we\'ll track your deadlines automatically.',
      requireInteraction: false,
    });
  }
});

// On service worker startup — re-setup alarm and catch-up on missed checks
chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  await runScheduledCheck(); // Catch up on any missed notifications while Chrome was closed
});

// Handle alarm ticks
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runScheduledCheck();
  }
});

// Handle messages from content.js and popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LMS_SCAN_RESULT') {
    processScannedItems(message.items)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'MARK_SUBMITTED') {
    markItemSubmitted(message.itemId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'DISMISS_ITEM') {
    dismissItem(message.itemId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    setupAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Open LMS URL when notification is clicked
chrome.notifications.onClicked.addListener(async (notifId) => {
  chrome.notifications.clear(notifId);

  if (notifId === 'vu-notifier-welcome') {
    chrome.tabs.create({ url: LMS_BASE_URL });
    return;
  }

  // Extract item ID from notification ID
  const itemId = notifId.replace('vu-notifier-', '');
  const { items } = await loadStorage();
  const item = items[itemId];

  if (item?.url) {
    chrome.tabs.create({ url: item.url });
  } else {
    chrome.tabs.create({ url: LMS_BASE_URL });
  }
});

// ─── Helpers for popup actions ─────────────────────────────────────────────────
async function markItemSubmitted(itemId) {
  const { items } = await loadStorage();
  if (items[itemId]) {
    items[itemId] = { ...items[itemId], status: 'submitted' };
    chrome.notifications.clear(notificationId(itemId)).catch(() => {});
    await saveItems(items);
  }
}

async function dismissItem(itemId) {
  const { items } = await loadStorage();
  if (items[itemId]) {
    items[itemId] = { ...items[itemId], status: 'expired' };
    chrome.notifications.clear(notificationId(itemId)).catch(() => {});
    await saveItems(items);
  }
}
