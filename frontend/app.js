/**
 * app.js — Frontend JS for VU LMS Notifier setup form.
 *
 * Handles:
 *  1. Service worker registration
 *  2. Push permission request + subscription creation
 *  3. POST /api/register to backend
 *  4. DELETE /api/students/:id for account deletion
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
// Set this to your backend VM's URL before deploying to Vercel.
// Example: 'https://1.2.3.4:3001'  or  'https://api.your-domain.com'
const BACKEND_URL = 'https://YOUR_BACKEND_VM_URL_HERE';

// ── UI helpers ────────────────────────────────────────────────────────────────
function showStatus(el, message, type /* 'success'|'error'|'info' */) {
  el.textContent = message;
  el.className   = `status-msg visible ${type}`;
}

function hideStatus(el) {
  el.className = 'status-msg';
  el.textContent = '';
}

// ── Service Worker registration ───────────────────────────────────────────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  // Wait until the service worker is active
  await new Promise((resolve) => {
    if (reg.active) { resolve(); return; }
    reg.addEventListener('updatefound', () => {
      reg.installing.addEventListener('statechange', function () {
        if (this.state === 'activated') resolve();
      });
    });
    // If already waiting, it will activate after skipWaiting
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  return reg;
}

// ── VAPID public key helper ───────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Push subscription ─────────────────────────────────────────────────────────
async function subscribeToPush(reg) {
  // Fetch the VAPID public key from backend
  const keyRes = await fetch(`${BACKEND_URL}/api/vapid-public-key`);
  if (!keyRes.ok) throw new Error('Could not fetch VAPID public key from backend.');
  const { publicKey } = await keyRes.json();

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly:      true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  return subscription;
}

// ── Registration flow ─────────────────────────────────────────────────────────
const form       = document.getElementById('register-form');
const submitBtn  = document.getElementById('submit-btn');
const statusMsg  = document.getElementById('status-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideStatus(statusMsg);

  const studentId = document.getElementById('student-id').value.trim();
  const password  = document.getElementById('password').value;

  if (!studentId || !password) {
    showStatus(statusMsg, 'Please enter your student ID and password.', 'error');
    return;
  }

  submitBtn.disabled   = true;
  submitBtn.textContent = '⏳ Setting up…';

  try {
    // Step 1: Request push permission
    showStatus(statusMsg, '🔔 Requesting notification permission…', 'info');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission was denied. Please allow notifications and try again.');
    }

    // Step 2: Register service worker + subscribe to push
    showStatus(statusMsg, '⚙️ Registering with push service…', 'info');
    const reg          = await registerServiceWorker();
    const subscription = await subscribeToPush(reg);

    // Step 3: Send to backend
    showStatus(statusMsg, '📤 Sending to server…', 'info');
    const res = await fetch(`${BACKEND_URL}/api/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ studentId, password, pushSubscription: subscription }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Registration failed. Please try again.');
    }

    // Success
    showStatus(statusMsg,
      '✅ ' + (data.message || 'Registered successfully! You\'ll receive push notifications for upcoming deadlines.'),
      'success'
    );
    form.reset();

  } catch (err) {
    showStatus(statusMsg, '❌ ' + err.message, 'error');
  } finally {
    submitBtn.disabled   = false;
    submitBtn.textContent = 'Enable Notifications';
  }
});

// ── Delete account flow ───────────────────────────────────────────────────────
const deleteBtn       = document.getElementById('delete-btn');
const deleteStatusMsg = document.getElementById('delete-status-msg');

deleteBtn.addEventListener('click', async () => {
  const studentId = document.getElementById('delete-id').value.trim();
  hideStatus(deleteStatusMsg);

  if (!studentId) {
    showStatus(deleteStatusMsg, 'Please enter your student ID.', 'error');
    return;
  }

  if (!confirm(`Delete all data for student ID "${studentId}"? This cannot be undone.`)) return;

  deleteBtn.disabled   = true;
  deleteBtn.textContent = '⏳ Deleting…';

  try {
    const res  = await fetch(`${BACKEND_URL}/api/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Delete failed.');

    showStatus(deleteStatusMsg, '✅ ' + data.message, 'success');
    document.getElementById('delete-id').value = '';

  } catch (err) {
    showStatus(deleteStatusMsg, '❌ ' + err.message, 'error');
  } finally {
    deleteBtn.disabled   = false;
    deleteBtn.textContent = '🗑 Delete My Account & Data';
  }
});

// ── PWA install prompt ────────────────────────────────────────────────────────
// Capture and hold the beforeinstallprompt event so we could show it later.
// (On iOS, the user must manually "Add to Home Screen" — we can't trigger it.)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Optionally surface an "Install App" button here for Android Chrome
});
