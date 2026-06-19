/**
 * scheduler.js — Escalation logic + node-cron job runner.
 *
 * Runs twice daily (8 AM and 8 PM PKT) via node-cron.
 * For each active student:
 *   1. Decrypt credentials → Playwright scrape → get items
 *   2. Diff scraped items against stored items
 *   3. Fire push notifications per escalation rules
 */

'use strict';

const cron      = require('node-cron');
const { decrypt }          = require('./crypto');
const { scrapeStudent }    = require('./scraper');
const { sendNotification } = require('./notifier');
const db = require('./db');

// ─── Escalation intervals (mirrors v1 scheduler.js) ───────────────────────────
const INTERVALS = {
  moreThan72h:     24 * 60 * 60 * 1000,  // once per 24 h
  between24and72h:  6 * 60 * 60 * 1000,  // once per 6 h
  between6and24h:   2 * 60 * 60 * 1000,  // once per 2 h
  lessThan6h:      30 * 60 * 1000,       // once per 30 min
};

function getRequiredInterval(deadlineISO) {
  const h = (new Date(deadlineISO).getTime() - Date.now()) / 3600000;
  if (h <= 0)   return null;
  if (h <= 6)   return INTERVALS.lessThan6h;
  if (h <= 24)  return INTERVALS.between6and24h;
  if (h <= 72)  return INTERVALS.between24and72h;
  return INTERVALS.moreThan72h;
}

function shouldNotifyNow(item) {
  if (item.status !== 'pending') return false;

  const interval = getRequiredInterval(item.deadline);
  if (!interval) return false; // expired — handled separately

  const lastAt = item.last_notified_at
    ? new Date(item.last_notified_at).getTime()
    : 0;

  return (Date.now() - lastAt) >= interval;
}

function getNotifyReason(item) {
  const h = (new Date(item.deadline).getTime() - Date.now()) / 3600000;
  if (h <= 6) return 'critical';
  return 'reminder';
}

// ─── Per-student check ────────────────────────────────────────────────────────
async function checkStudent(student) {
  const logPrefix = `[scheduler][${student.student_id}]`;

  let creds;
  try {
    creds = JSON.parse(decrypt(student.cred_enc));
  } catch (err) {
    console.error(`${logPrefix} Failed to decrypt credentials: ${err.message}`);
    return;
  }

  let scrapedItems;
  try {
    scrapedItems = await scrapeStudent(creds.studentId, creds.password);
  } catch (err) {
    console.error(`${logPrefix} Scrape failed: ${err.message}`);
    return;
  }

  db.markLastChecked(student.student_id);

  // ── Diff + notify ────────────────────────────────────────────────────────
  for (const incoming of scrapedItems) {
    const stored = db.getItem(student.student_id, incoming.itemKey);

    if (!stored) {
      // ── NEW ITEM ──────────────────────────────────────────────────────────
      db.insertItem({
        studentId:  student.student_id,
        itemKey:    incoming.itemKey,
        type:       incoming.type,
        title:      incoming.title,
        courseCode: incoming.courseCode,
        deadline:   incoming.deadline,
        status:     incoming.status,
        url:        incoming.url,
      });

      if (incoming.status !== 'submitted') {
        try {
          await sendNotification(student.push_sub, { ...incoming, item_key: incoming.itemKey, course_code: incoming.courseCode }, 'new');
          db.recordNotificationSent(student.student_id, incoming.itemKey);
          console.log(`${logPrefix} 🔔 New ${incoming.type}: "${incoming.title}"`);
        } catch (err) {
          handlePushError(err, student);
        }
      }
      continue;
    }

    // ── EXISTING: status changed to submitted ─────────────────────────────
    if (stored.status === 'pending' && incoming.status === 'submitted') {
      db.updateItemStatus(student.student_id, incoming.itemKey, 'submitted');
      console.log(`${logPrefix} ✅ Submitted: "${incoming.title}"`);
      continue;
    }

    // ── EXISTING + PENDING: check escalation ──────────────────────────────
    if (stored.status === 'pending') {
      if (shouldNotifyNow(stored)) {
        const reason = getNotifyReason(stored);
        try {
          await sendNotification(student.push_sub, stored, reason);
          db.recordNotificationSent(student.student_id, incoming.itemKey);
          console.log(`${logPrefix} ⏰ ${reason} for "${stored.title}"`);
        } catch (err) {
          handlePushError(err, student);
        }
      }
    }
  }

  // ── Expire overdue items + send final "missed" notification ──────────────
  const pendingItems = db.getPendingItems(student.student_id);
  for (const item of pendingItems) {
    if (new Date(item.deadline).getTime() < Date.now()) {
      db.updateItemStatus(student.student_id, item.item_key, 'expired');
      try {
        await sendNotification(student.push_sub, item, 'missed');
        console.log(`${logPrefix} ❌ Missed: "${item.title}"`);
      } catch (err) {
        handlePushError(err, student);
      }
    }
  }
}

function handlePushError(err, student) {
  if (err.message === 'PUSH_SUBSCRIPTION_EXPIRED') {
    console.warn(`[scheduler] Push subscription expired for ${student.student_id} — deactivating`);
    // Mark student inactive so we stop trying to push to a dead subscription
    db.db.prepare("UPDATE students SET active = 0 WHERE student_id = ?").run(student.student_id);
  } else {
    console.error(`[scheduler] Push error: ${err.message}`);
  }
}

// ─── Full check pass: all active students ────────────────────────────────────
async function runCheckPass() {
  const students = db.getAllActiveStudents();
  console.log(`\n[scheduler] ▶ Check pass started — ${students.length} active student(s)`);

  for (const student of students) {
    await checkStudent(student);
  }

  console.log('[scheduler] ✔ Check pass complete\n');
}

// ─── Cron setup ──────────────────────────────────────────────────────────────
function startScheduler() {
  const morning = process.env.CRON_SCHEDULE_MORNING || '0 3 * * *';  // 08:00 PKT
  const evening = process.env.CRON_SCHEDULE_EVENING || '0 15 * * *'; // 20:00 PKT

  cron.schedule(morning, runCheckPass, { timezone: 'UTC' });
  cron.schedule(evening, runCheckPass, { timezone: 'UTC' });

  console.log(`[scheduler] Cron scheduled: morning="${morning}" evening="${evening}" (UTC)`);
}

module.exports = { startScheduler, runCheckPass };
