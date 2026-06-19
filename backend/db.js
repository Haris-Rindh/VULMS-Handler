/**
 * db.js — SQLite database initialisation and query helpers.
 *
 * Uses better-sqlite3 (synchronous API — fine for our single-process,
 * low-concurrency use case).
 *
 * Database file: ./data/notifier.db  (gitignored)
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

// Ensure the data/ directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'notifier.db');
const db      = new Database(DB_PATH);

// Enable WAL mode for better concurrency (reads don't block writes)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT    NOT NULL UNIQUE,
    cred_enc     TEXT    NOT NULL,   -- AES-256-GCM encrypted JSON {studentId, password}
    push_sub     TEXT    NOT NULL,   -- JSON web-push PushSubscription object
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT,               -- ISO 8601 timestamp of last successful scrape
    active       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id       TEXT    NOT NULL,
    item_key         TEXT    NOT NULL,   -- stable hash: type|course|title|deadline
    type             TEXT    NOT NULL,   -- 'assignment' | 'quiz' | 'gdb'
    title            TEXT    NOT NULL,
    course_code      TEXT    NOT NULL,
    deadline         TEXT    NOT NULL,   -- ISO 8601
    status           TEXT    NOT NULL DEFAULT 'pending', -- 'pending'|'submitted'|'expired'
    url              TEXT,
    first_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_notified_at TEXT,
    notify_count     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(student_id, item_key),
    FOREIGN KEY(student_id) REFERENCES students(student_id) ON DELETE CASCADE
  );
`);

// ─── Student helpers ──────────────────────────────────────────────────────────

const stmtInsertStudent = db.prepare(`
  INSERT INTO students (student_id, cred_enc, push_sub)
  VALUES (@studentId, @credEnc, @pushSub)
  ON CONFLICT(student_id) DO UPDATE SET
    cred_enc = excluded.cred_enc,
    push_sub = excluded.push_sub,
    active   = 1
`);

const stmtGetStudent    = db.prepare('SELECT * FROM students WHERE student_id = ?');
const stmtAllStudents   = db.prepare('SELECT * FROM students WHERE active = 1');
const stmtDeleteStudent = db.prepare('DELETE FROM students WHERE student_id = ?');
const stmtSetLastChecked = db.prepare(
  "UPDATE students SET last_checked = datetime('now') WHERE student_id = ?"
);

function upsertStudent({ studentId, credEnc, pushSub }) {
  stmtInsertStudent.run({ studentId, credEnc, pushSub });
}

function getStudent(studentId) {
  return stmtGetStudent.get(studentId) || null;
}

function getAllActiveStudents() {
  return stmtAllStudents.all();
}

function deleteStudent(studentId) {
  stmtDeleteStudent.run(studentId);
}

function markLastChecked(studentId) {
  stmtSetLastChecked.run(studentId);
}

// ─── Item helpers ─────────────────────────────────────────────────────────────

const stmtGetItem = db.prepare(
  'SELECT * FROM items WHERE student_id = ? AND item_key = ?'
);

const stmtInsertItem = db.prepare(`
  INSERT INTO items (student_id, item_key, type, title, course_code, deadline, status, url)
  VALUES (@studentId, @itemKey, @type, @title, @courseCode, @deadline, @status, @url)
`);

const stmtUpdateStatus = db.prepare(
  "UPDATE items SET status = @status WHERE student_id = @studentId AND item_key = @itemKey"
);

const stmtUpdateNotified = db.prepare(`
  UPDATE items
  SET last_notified_at = datetime('now'),
      notify_count     = notify_count + 1
  WHERE student_id = ? AND item_key = ?
`);

const stmtPendingItems = db.prepare(
  "SELECT * FROM items WHERE student_id = ? AND status = 'pending'"
);

const stmtExpireOverdue = db.prepare(`
  UPDATE items
  SET status = 'expired'
  WHERE status = 'pending' AND deadline < datetime('now')
`);

function getItem(studentId, itemKey) {
  return stmtGetItem.get(studentId, itemKey) || null;
}

function insertItem({ studentId, itemKey, type, title, courseCode, deadline, status, url }) {
  stmtInsertItem.run({ studentId, itemKey, type, title, courseCode, deadline, status: status || 'pending', url });
}

function updateItemStatus(studentId, itemKey, status) {
  stmtUpdateStatus.run({ status, studentId, itemKey });
}

function recordNotificationSent(studentId, itemKey) {
  stmtUpdateNotified.run(studentId, itemKey);
}

function getPendingItems(studentId) {
  return stmtPendingItems.all(studentId);
}

/** Mark all items whose deadline has passed as 'expired'. Runs on each check. */
function expireOverdueItems() {
  return stmtExpireOverdue.run().changes;
}

module.exports = {
  db,
  // students
  upsertStudent,
  getStudent,
  getAllActiveStudents,
  deleteStudent,
  markLastChecked,
  // items
  getItem,
  insertItem,
  updateItemStatus,
  recordNotificationSent,
  getPendingItems,
  expireOverdueItems,
};
