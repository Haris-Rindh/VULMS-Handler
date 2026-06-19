/**
 * scheduler.js — Escalation logic for deadline notifications.
 * Determines when to fire the next notification based on time left until deadline.
 */

const PRESETS = {
  normal: {
    moreThan72h:  24 * 60 * 60 * 1000,   // 24 hours
    between24and72h: 6 * 60 * 60 * 1000, // 6 hours
    between6and24h:  2 * 60 * 60 * 1000, // 2 hours
    lessThan6h:   30 * 60 * 1000,         // 30 minutes
  },
  aggressive: {
    moreThan72h:  12 * 60 * 60 * 1000,   // 12 hours
    between24and72h: 3 * 60 * 60 * 1000, // 3 hours
    between6and24h:  1 * 60 * 60 * 1000, // 1 hour
    lessThan6h:   15 * 60 * 1000,         // 15 minutes
  }
};

/**
 * Returns the required interval (ms) between notifications given time left.
 * @param {number} deadline - timestamp (ms) of the deadline
 * @param {number} now - current timestamp (ms)
 * @param {string} preset - "normal" | "aggressive"
 * @returns {number|null} interval in ms, or null if expired
 */
function getNextNotificationDelay(deadline, now, preset = 'normal') {
  const msLeft = deadline - now;
  if (msLeft <= 0) return null; // expired

  const intervals = PRESETS[preset] || PRESETS.normal;
  const hoursLeft = msLeft / (1000 * 60 * 60);

  if (hoursLeft > 72) return intervals.moreThan72h;
  if (hoursLeft > 24) return intervals.between24and72h;
  if (hoursLeft > 6)  return intervals.between6and24h;
  return intervals.lessThan6h;
}

/**
 * Returns true if a notification should fire right now for this item.
 * Factors in quiet hours (except when deadline < 6 hours away — always override).
 * @param {Object} item - stored item record
 * @param {number} now - current timestamp (ms)
 * @param {Object} settings - user settings from storage
 * @returns {boolean}
 */
function shouldNotify(item, now, settings) {
  if (item.status === 'submitted' || item.status === 'expired') return false;

  const deadline = new Date(item.deadline).getTime();
  const msLeft = deadline - now;
  const hoursLeft = msLeft / (1000 * 60 * 60);

  // Deadline fully passed — handled by expiry logic separately
  if (msLeft <= 0) return false;

  const preset = (settings && settings.preset) || 'normal';
  const interval = getNextNotificationDelay(deadline, now, preset);
  if (!interval) return false;

  const lastNotified = item.lastNotifiedAt ? new Date(item.lastNotifiedAt).getTime() : 0;
  const timeSinceLast = now - lastNotified;

  // Not enough time has passed since last notification
  if (timeSinceLast < interval) return false;

  // Check quiet hours (skip if critical: < 6 hours left — always wake up)
  if (hoursLeft > 6 && isInQuietHours(now, settings)) return false;

  return true;
}

/**
 * Returns true if current time is within quiet hours.
 * @param {number} now - current timestamp (ms)
 * @param {Object} settings
 * @returns {boolean}
 */
function isInQuietHours(now, settings) {
  if (!settings || !settings.quietHoursStart || !settings.quietHoursEnd) return false;

  const date = new Date(now);
  const [startH, startM] = settings.quietHoursStart.split(':').map(Number);
  const [endH, endM]     = settings.quietHoursEnd.split(':').map(Number);

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes   = startH * 60 + startM;
  const endMinutes     = endH * 60 + endM;

  // Handle overnight quiet period (e.g. 23:00 – 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Returns true if the item's deadline is within the "critical" window (< 6 hours).
 * Critical notifications use requireInteraction and can play sound.
 * @param {Object} item
 * @param {number} now
 * @returns {boolean}
 */
function isCritical(item, now) {
  const deadline = new Date(item.deadline).getTime();
  const hoursLeft = (deadline - now) / (1000 * 60 * 60);
  return hoursLeft > 0 && hoursLeft <= 6;
}

/**
 * Returns a human-readable countdown string.
 * @param {number} deadline - timestamp (ms)
 * @param {number} now - current timestamp (ms)
 * @returns {string}
 */
function formatCountdown(deadline, now) {
  const ms = deadline - now;
  if (ms <= 0) return 'Deadline passed';

  const totalSeconds = Math.floor(ms / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0)    return `${days}d ${hours}h left`;
  if (hours > 0)   return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

/**
 * Returns urgency level for UI theming.
 * @param {number} hoursLeft
 * @returns {'safe'|'warn'|'critical'}
 */
function getUrgencyLevel(hoursLeft) {
  if (hoursLeft <= 6)  return 'critical';
  if (hoursLeft <= 24) return 'warn';
  return 'safe';
}
