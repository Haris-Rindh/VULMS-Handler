/**
 * notifier.js — Web-push notification sender using VAPID + web-push.
 *
 * VAPID keys are generated once on the VM and stored in .env.
 * Generate them with:   npx web-push generate-vapid-keys
 */

'use strict';

const webpush = require('web-push');

// ─── VAPID setup (runs once at module load) ───────────────────────────────────
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_EMAIL) {
  throw new Error(
    'Missing VAPID env vars. Generate keys with: npx web-push generate-vapid-keys\n' +
    'Then set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL in .env'
  );
}

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ─── Urgency formatting ───────────────────────────────────────────────────────
function formatCountdown(deadlineISO) {
  const ms = new Date(deadlineISO).getTime() - Date.now();
  if (ms <= 0) return 'Deadline passed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

const TYPE_EMOJI = { assignment: '📝', quiz: '📋', gdb: '💬' };
const TYPE_LABEL = { assignment: 'Assignment', quiz: 'Quiz', gdb: 'GDB' };

/**
 * Sends a push notification for a single LMS item.
 *
 * @param {string} pushSubJSON   — JSON string of the PushSubscription object
 * @param {Object} item          — item row from SQLite
 * @param {'new'|'reminder'|'critical'|'missed'} reason
 * @returns {Promise<void>}
 */
async function sendNotification(pushSubJSON, item, reason) {
  const subscription = JSON.parse(pushSubJSON);
  const deadline     = item.deadline;
  const countdown    = formatCountdown(deadline);
  const emoji        = TYPE_EMOJI[item.type] || '📌';
  const label        = TYPE_LABEL[item.type] || 'Item';

  let title, body;

  switch (reason) {
    case 'new':
      title = `${emoji} New ${label} — ${item.course_code}`;
      body  = `"${item.title}" — Due: ${countdown}`;
      break;
    case 'critical':
      title = `🚨 URGENT — ${label} Due Soon! (${item.course_code})`;
      body  = `${emoji} "${item.title}" — ${countdown}`;
      break;
    case 'missed':
      title = `❌ Missed ${label} — ${item.course_code}`;
      body  = `"${item.title}" deadline has passed without submission.`;
      break;
    case 'reminder':
    default:
      title = `⏰ ${label} Reminder — ${item.course_code}`;
      body  = `${emoji} "${item.title}" — ${countdown}`;
      break;
  }

  const payload = JSON.stringify({
    title,
    body,
    url:   item.url || 'https://vulms.vu.edu.pk',
    badge: '/icons/icon48.png',
    icon:  '/icons/icon128.png',
    tag:   `vu-notifier-${item.item_key}`,           // replaces previous notif for same item
    requireInteraction: reason === 'critical' || reason === 'missed',
  });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    if (err.statusCode === 410) {
      // 410 Gone — the push subscription is no longer valid (user cleared browser data)
      // Caller should mark the student as inactive
      const e = new Error('PUSH_SUBSCRIPTION_EXPIRED');
      e.studentId = item.student_id;
      throw e;
    }
    throw err;
  }
}

module.exports = { sendNotification, VAPID_PUBLIC_KEY };
