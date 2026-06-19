/**
 * server.js — Express API server for VU LMS Deadline Notifier.
 *
 * Routes:
 *   POST   /api/register        — register student credentials + push subscription
 *   DELETE /api/students/:id    — delete student data (GDPR-style right to erasure)
 *   GET    /api/vapid-public-key — serve public key to frontend for push subscription setup
 *   GET    /api/health           — liveness probe
 *   POST   /api/check-now        — (dev only) trigger a check pass immediately
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { encrypt }         = require('./crypto');
const { upsertStudent, deleteStudent, getStudent } = require('./db');
const { VAPID_PUBLIC_KEY } = require('./notifier');
const { startScheduler, runCheckPass } = require('./scheduler');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Simple liveness check.
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * GET /api/vapid-public-key
 * Returns the VAPID public key so the frontend can subscribe to push.
 */
app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/**
 * POST /api/register
 * Body: { studentId, password, pushSubscription }
 *
 * Encrypts credentials with AES-256-GCM before storing.
 * Never logs the password.
 */
app.post('/api/register', (req, res) => {
  const { studentId, password, pushSubscription } = req.body;

  if (!studentId || !password || !pushSubscription) {
    return res.status(400).json({ error: 'studentId, password, and pushSubscription are required.' });
  }

  if (typeof studentId !== 'string' || !/^\d{7,12}$/.test(studentId.trim())) {
    return res.status(400).json({ error: 'Invalid student ID format.' });
  }

  if (typeof password !== 'string' || password.length < 4 || password.length > 15) {
    return res.status(400).json({ error: 'Password must be 4–15 characters.' });
  }

  try {
    const credEnc = encrypt(JSON.stringify({ studentId: studentId.trim(), password }));
    const pushSub = typeof pushSubscription === 'string'
      ? pushSubscription
      : JSON.stringify(pushSubscription);

    upsertStudent({ studentId: studentId.trim(), credEnc, pushSub });

    console.log(`[server] Registered student: ${studentId.trim()}`);
    return res.json({ success: true, message: 'Registration successful. You will receive notifications for upcoming deadlines.' });

  } catch (err) {
    console.error('[server] Registration error:', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/**
 * DELETE /api/students/:id
 * Deletes all data for a student (credentials + tracked items).
 */
app.delete('/api/students/:id', (req, res) => {
  const studentId = req.params.id;

  if (!getStudent(studentId)) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  try {
    deleteStudent(studentId);
    console.log(`[server] Deleted student: ${studentId}`);
    return res.json({ success: true, message: 'All your data has been deleted.' });
  } catch (err) {
    console.error('[server] Delete error:', err.message);
    return res.status(500).json({ error: 'Delete failed.' });
  }
});

/**
 * POST /api/check-now
 * Triggers an immediate check pass (for development/testing only).
 * In production, remove or add authentication.
 */
app.post('/api/check-now', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production.' });
  }
  try {
    res.json({ success: true, message: 'Check pass triggered.' });
    await runCheckPass(); // run after responding so the HTTP request doesn't time out
  } catch (err) {
    console.error('[server] Manual check error:', err.message);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] VU LMS Notifier backend listening on port ${PORT}`);
  startScheduler();
});
