# VU LMS Deadline Notifier 🔔

> **Never miss an assignment, quiz, or GDB again.**

An automated deadline tracking system for Virtual University of Pakistan (VU) students. It monitors the LMS on a schedule, detects new assignments, quizzes, and Graded Discussion Boards, and fires escalating push notifications — directly to your desktop and mobile — until you submit or the deadline passes.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Repository Structure](#repository-structure)
- [V1 — Chrome Extension (Local)](#v1--chrome-extension-local)
- [V2 — Backend + Push Notifications](#v2--backend--push-notifications)
- [Security Model](#security-model)
- [Playwright Login Spike](#playwright-login-spike)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Overview

| | V1 — Chrome Extension | V2 — Backend Service |
|---|---|---|
| **How it runs** | In your browser, passively | On a server, 24/7 |
| **Credential storage** | None — uses your live browser session | AES-256-GCM encrypted in SQLite |
| **Push target** | Desktop Chrome notifications | Web push (desktop + mobile) |
| **Multi-user** | No — one browser, one student | Yes — up to ~5 students |
| **Works when browser is closed** | No | Yes |
| **Requires setup** | Load unpacked extension | Deploy VM + Vercel |

Both versions share the same notification escalation logic and parsing approach.

---

## System Architecture

### V1 — Chrome Extension

```
Browser (VULMS tab)
|
+-- content.js          <- injected at document_idle; runs parser.js
|   +-- parser.js       <- scrapes DOM for assignments/quizzes/GDBs
|
+-- background.js       <- Service Worker; alarm-based polling + diffing
|   +-- chrome.storage  <- persists seen items + notification state
|   +-- chrome.alarms   <- drives escalation schedule
|
+-- popup/              <- toolbar popup with live countdowns
+-- options/            <- settings page (quiet hours, selectors, presets)
+-- utils/audio.html    <- offscreen document for Web Audio chime
```

### V2 — Backend + Push

```
Vercel (static CDN)                    Oracle Cloud VM / Linux Server
                                       
frontend/                              backend/
+-- index.html   (signup form)  <----> +-- server.js    (Express API)
+-- app.js       (push sub)            +-- scheduler.js (node-cron 2x/day)
+-- sw.js        (service worker)      +-- scraper.js   (Playwright login)
+-- manifest.webmanifest (PWA)         +-- notifier.js  (web-push VAPID)
                                       +-- db.js        (SQLite)
                                       +-- crypto.js    (AES-256-GCM)
```

**Data flow:**
1. Student visits Vercel frontend, enters VU ID + password, browser requests push permission
2. Frontend POSTs encrypted credentials + push subscription to backend VM
3. Backend stores everything in SQLite; cron fires at 08:00 and 20:00 PKT
4. Playwright logs into VULMS, scrapes listing pages, diffs against DB
5. New or escalated items trigger web-push notification to student device
6. Notification appears on desktop or phone; tapping opens the VULMS URL directly

---

## Repository Structure

```
Assignment detector/
|
|  -- V1: Chrome Extension (root) ------------------------------------------
+-- manifest.json          Chrome extension config (Manifest V3)
+-- background.js          Service worker: alarms, storage diff, notifications
+-- content.js             Injected on VULMS pages: scrapes & messages background
|
+-- utils/
|   +-- parser.js          DOM scraper + heuristic keyword/date fallback
|   +-- scheduler.js       Escalation interval calculator + quiet hours
|   +-- audio.html         Offscreen document (Web Audio API chime)
|   +-- audio.js           Chime synthesiser
|
+-- popup/
|   +-- popup.html         Toolbar popup UI
|   +-- popup.css          Dark glassmorphism styling
|   +-- popup.js           Live countdown timers, filter tabs, actions
|
+-- options/
|   +-- options.html       Settings page
|   +-- options.css
|   +-- options.js         Presets, quiet hours, custom DOM selectors
|
+-- icons/
|   +-- icon16.png
|   +-- icon48.png
|   +-- icon128.png
|
+-- test/
|   +-- mock_lms.html      Simulated VULMS dashboard for offline testing
|
|  -- V2: Backend -----------------------------------------------------------
+-- backend/
|   +-- server.js          Express API server
|   +-- scheduler.js       node-cron 2x/day + full diff/escalation loop
|   +-- scraper.js         Playwright: login then scrape assignments/quizzes/GDBs
|   +-- notifier.js        web-push VAPID notification sender
|   +-- db.js              SQLite schema + query helpers (better-sqlite3)
|   +-- crypto.js          AES-256-GCM encrypt/decrypt for stored credentials
|   +-- package.json
|   +-- .env.example       Documents all required environment variables
|   +-- .gitignore
|   +-- data/              SQLite database lives here (gitignored)
|   +-- spike/
|       +-- login-test.js  Standalone Playwright login verification script
|       +-- .env.example
|       +-- package.json
|
|  -- V2: Frontend ----------------------------------------------------------
+-- frontend/
|   +-- index.html         Student registration form (premium dark UI)
|   +-- app.js             SW registration, push subscribe, API calls
|   +-- sw.js              Service worker: push receipt, notification display
|   +-- manifest.webmanifest  PWA manifest (installable on Android/iOS)
|
+-- README.md
```

---

## V1 — Chrome Extension (Local)

### How it works

1. You log into vulms.vu.edu.pk normally in Chrome.
2. `content.js` fires at `document_idle` on every VULMS page and runs `parser.js` against the DOM.
3. Parsed items are sent to `background.js` via `chrome.runtime.sendMessage`.
4. The background service worker diffs incoming items against `chrome.storage.local`.
5. New items trigger an immediate Chrome notification + a scheduled alarm.
6. As deadlines approach, alarms fire at increasing frequency; each fires another notification.
7. Once the LMS reports an item as "Submitted" (parser detects status text), notifications stop.
8. After the deadline, one final "Missed" notification is sent and the item is archived.

No credentials are ever stored. The extension reads only pages you are already authorised to see.

### Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer Mode** (top-right toggle).
4. Click **"Load unpacked"** and select the `Assignment detector` folder (the root — where `manifest.json` lives).
5. Pin the extension icon in your toolbar.
6. Log into vulms.vu.edu.pk — detection starts automatically.

> **Testing without a real login:** Open `test/mock_lms.html` in Chrome. Add `"file:///*"` to `host_permissions` in `manifest.json` temporarily. The parser will find the mock items and the popup will display them immediately. Revert the manifest change before use.

### Notification schedule

| Time before deadline | Frequency |
|---|---|
| Newly detected | Immediate |
| > 72 hours | Every 24 hours |
| 24 to 72 hours | Every 6 hours |
| 6 to 24 hours | Every 2 hours |
| < 6 hours | Every 30 min + audio chime + sticky notification |
| Deadline passed | One "Missed" notification, then stops |

Quiet hours (configurable in Settings) suppress all notifications during your sleep window.

### Customising selectors

If VU updates the LMS layout and items stop appearing:

1. Click the extension icon → **Settings ⚙️** → **Custom DOM Selectors**.
2. Open DevTools on the affected VULMS page.
3. Right-click a row element → Inspect → copy the CSS selector.
4. Paste into the relevant field and click Save Settings.

The parser also has a keyword/date heuristic fallback in `utils/parser.js` that scans full page text — this catches items even when the DOM structure changes completely.

---

## V2 — Backend + Push Notifications

### How it works

1. Each student visits the Vercel-hosted signup form, enters VU credentials, and grants notification permission.
2. The frontend registers a service worker, creates a Web Push subscription, and POSTs `{ studentId, password, pushSubscription }` to the backend.
3. The backend encrypts `{ studentId, password }` with AES-256-GCM and stores the ciphertext in SQLite alongside the push subscription.
4. `node-cron` fires the check job at 08:00 PKT and 20:00 PKT every day.
5. For each student, Playwright decrypts their credentials, launches headless Chromium, logs into VULMS, navigates to listing pages, and parses the tables.
6. Scraped items are diffed against the database.
7. `web-push` sends the notification to the student's browser via VAPID.
8. The service worker on the frontend receives the push event and shows the notification.

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- A persistent Linux server (Oracle Cloud Always Free Ampere is the target; Render free tier is a fallback)
- A Vercel account (free tier) for the frontend

### Backend setup

#### 1. Install dependencies

```bash
cd "Assignment detector/backend"
npm install
npx playwright install chromium
```

#### 2. Generate secrets (run once, save output immediately)

```bash
# AES-256-GCM encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# VAPID keys for web-push
npx web-push generate-vapid-keys
```

IMPORTANT: Back up the ENCRYPTION_KEY outside the VM immediately. If the VM is lost without a backup of this key, all stored credentials become unrecoverable.

#### 3. Create .env

```bash
cp .env.example .env
nano .env   # fill in all values — see Environment Variables Reference below
```

#### 4. Start the server

```bash
# Production
node server.js

# Keep running after disconnect
pm2 start server.js --name vu-notifier
# or
nohup node server.js &> server.log &
```

#### 5. Open the firewall port (Oracle Cloud)

In the OCI Console:
- Networking → VCN → Security Lists → Add Ingress Rule
- Source CIDR: 0.0.0.0/0, Protocol: TCP, Port: 3001

On the VM itself (Ubuntu):
```bash
sudo ufw allow 3001/tcp
# or for Oracle Linux:
sudo firewall-cmd --permanent --add-port=3001/tcp && sudo firewall-cmd --reload
```

Verify: `curl http://<your-vm-ip>:3001/api/health` should return `{"status":"ok"}`.

### Frontend setup

#### 1. Set the backend URL

Open `frontend/app.js` line 9 and replace:
```js
const BACKEND_URL = 'https://YOUR_BACKEND_VM_URL_HERE';
```
with your VM's public IP or domain, e.g.:
```js
const BACKEND_URL = 'http://1.2.3.4:3001';
```

#### 2. Deploy to Vercel

```bash
npm i -g vercel
cd frontend/
vercel --prod
```

Or use the Vercel dashboard: New Project → Import from Git → set root directory to `frontend/`.

#### 3. Update CORS on backend

Add your Vercel URL to `.env`:
```env
FRONTEND_ORIGIN=https://vu-notifier.vercel.app
```
Restart the backend.

### Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Yes | 64-char hex string (32 bytes). Generate with `crypto.randomBytes(32).toString('hex')`. Back this up. |
| `VAPID_PUBLIC_KEY` | Yes | VAPID public key from `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | Yes | VAPID private key. Keep secret. |
| `VAPID_EMAIL` | Yes | `mailto:you@example.com` — identifies your push server. |
| `PORT` | Yes | Express listen port. Default: 3001. |
| `FRONTEND_ORIGIN` | Yes | Your Vercel URL, e.g. `https://vu-notifier.vercel.app`. Used for CORS. |
| `CRON_SCHEDULE_MORNING` | Optional | node-cron expression. Default: `0 3 * * *` (08:00 PKT = UTC 03:00). |
| `CRON_SCHEDULE_EVENING` | Optional | node-cron expression. Default: `0 15 * * *` (20:00 PKT = UTC 15:00). |

### API Reference

Base URL: `http://<your-vm-ip>:<PORT>`

---

**GET /api/health**
Liveness check.
```json
{ "status": "ok", "time": "2026-06-20T15:00:00.000Z" }
```

---

**GET /api/vapid-public-key**
Returns the VAPID public key for the frontend push subscription setup.
```json
{ "publicKey": "BN3..." }
```

---

**POST /api/register**
Registers a student's credentials and push subscription.

Request body:
```json
{
  "studentId": "BC220400123",
  "password": "yourLMSPassword",
  "pushSubscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
}
```

- `studentId`: 7-12 digits
- `password`: 4-15 characters
- Re-registering with the same ID updates credentials and push subscription in place.

Success `200`: `{ "success": true, "message": "Registration successful..." }`

---

**DELETE /api/students/:id**
Deletes all data for a student — credentials, push subscription, and all tracked items.

Example: `DELETE /api/students/BC220400123`

Success `200`: `{ "success": true, "message": "All your data has been deleted." }`

---

**POST /api/check-now** *(development only)*
Immediately triggers a full check pass. Returns 403 in production.

```bash
curl -X POST http://localhost:3001/api/check-now
```

### Deployment Checklist

Backend VM:
- [ ] Node.js 18+ installed
- [ ] `npm install` run inside `backend/`
- [ ] `npx playwright install chromium` run
- [ ] `.env` created with all secrets filled in
- [ ] `ENCRYPTION_KEY` backed up outside the VM
- [ ] Server running under pm2 or nohup
- [ ] Port open in OCI security list AND OS firewall
- [ ] `curl http://<ip>:3001/api/health` returns `{"status":"ok"}`

Frontend (Vercel):
- [ ] `BACKEND_URL` in `frontend/app.js` updated to real VM URL
- [ ] Deployed to Vercel
- [ ] `FRONTEND_ORIGIN` in backend `.env` updated to Vercel URL
- [ ] Backend restarted after CORS change

Per-student:
- [ ] Student visits Vercel URL
- [ ] Fills in VU ID + password, clicks "Enable Notifications"
- [ ] Browser grants notification permission
- [ ] Success message shown
- [ ] Test: `curl -X POST http://<vm-ip>:3001/api/check-now` (dev only)
- [ ] Notification appears on device

---

## Security Model

| Concern | Implementation |
|---|---|
| Credential storage | AES-256-GCM with a random 96-bit IV per encryption. Ciphertext + IV + auth tag stored as JSON in SQLite. |
| Key management | `ENCRYPTION_KEY` lives only in `.env` on the VM. You are responsible for backing it up offline. |
| Tamper detection | GCM auth tag — any modification to ciphertext causes decryption to throw. |
| No plaintext in logs | Log statements reference student IDs only. Passwords never appear in any log or error message. |
| No plaintext in Git | `.env`, `data/*.db`, and screenshots are in `.gitignore`. |
| CORS | Backend accepts requests only from `FRONTEND_ORIGIN`. |
| Right to erasure | `DELETE /api/students/:id` removes all data in one call via cascading foreign key delete. |
| Scope | Designed for 3-5 known students, not a public service. The API has no authentication beyond CORS — do not expose publicly without adding a shared secret or invite token. |

---

## Playwright Login Spike

Before deploying, verify that Playwright can log into VULMS headlessly:

```bash
cd backend/spike
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env: fill in VU_STUDENT_ID and VU_PASSWORD
node login-test.js
```

Expected output on success:
```
🚀  Launching headless Chromium...
🌐  Navigating to https://vulms.vu.edu.pk/LMS_LP.aspx ...
📋  Login form found.
✏️   Credentials entered.
🖱️   Clicking Sign In...

✅  Login successful!
📄  Page title : "Virtual University of Pakistan"
🔗  Current URL: https://vulms.vu.edu.pk/Home.aspx?id=...
🖼️   Screenshot saved to spike-screenshot.png

🎉  Spike complete — Playwright can log into VULMS headlessly.
```

Open `spike-screenshot.png` to visually confirm you are on the dashboard.

---

## Troubleshooting

### Chrome Extension (V1)

**Items not appearing in popup**
- Visit a VULMS page while logged in. Open DevTools → Console and check for errors from `content.js`.
- If the LMS layout changed, update selectors in Settings → Custom DOM Selectors.
- Check for `[parser] heuristic` log lines — the fallback scanner may be catching items with lower confidence.

**Notifications not firing**
- Check Chrome notification permission: `chrome://settings/content/notifications`
- Confirm that quiet hours in the extension settings are not covering the current time.

**Extension not loading**
- Confirm you selected the root `Assignment detector` folder (where `manifest.json` is), not a subdirectory.

### Backend (V2)

**"ENCRYPTION_KEY must be a 64-character hex string" error**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste the output into ENCRYPTION_KEY in .env
```

**Playwright times out on login**
- Run the standalone spike first: `node backend/spike/login-test.js`
- Set `headless: false` in `scraper.js` temporarily to watch the browser live.
- The LMS may be slow — increase `TIMEOUT_MS` in `scraper.js` from 30000 to 60000.

**Push notifications not arriving**
- Verify all three VAPID variables are set correctly in `.env`.
- Check that the browser has notification permission for your Vercel domain.
- On iOS, the page must be added to the Home Screen first (iOS 16.4+).
- Look for `PUSH_SUBSCRIPTION_EXPIRED` in server logs — the student must re-register.

**0 items found by scraper**
- VULMS listing page URLs or table structure may have changed.
- Inspect the live pages in DevTools and update the `PAGES` and `SELECTORS` objects in `scraper.js`.
- Trigger a manual check during development: `curl -X POST http://localhost:3001/api/check-now`

---

## Roadmap

| Item | Status |
|---|---|
| V1 Chrome Extension | Done |
| V2 Backend scaffold (Express + SQLite + AES + node-cron) | Done |
| V2 Playwright scraper | Written — selectors need live verification |
| V2 Push notifications (VAPID + web-push) | Done |
| V2 Frontend setup form (Vercel PWA) | Done |
| Playwright spike pass with real credentials | Pending |
| VULMS selector verification post-login | Pending |
| Oracle VM deployment | Pending |
| Android push via Chrome PWA | Ready when backend is deployed |
| iOS push (Home Screen install) | Ready on iOS 16.4+ |
| Email digest (weekly summary) | Future |
| Invite token / simple auth for API | Future |
| Multi-device: one student, multiple push subscriptions | Future |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension runtime | Chrome Manifest V3 / Service Worker |
| Backend runtime | Node.js 18+ |
| Web framework | Express 4 |
| Database | SQLite via better-sqlite3 |
| Browser automation | Playwright (Chromium) |
| Push notifications | Web Push / VAPID via web-push |
| Credential encryption | AES-256-GCM (Node.js built-in crypto) |
| Scheduling | node-cron |
| Frontend hosting | Vercel (static) |
| Backend hosting | Oracle Cloud Always Free / any persistent VM |

---

## Privacy Statement

- No data is sent to third parties. All processing happens on the VM you control.
- Credentials are encrypted before being written to disk. The encryption key never leaves your VM's `.env` file.
- Push subscriptions are browser-generated tokens — they contain no personal information.
- You can delete all your data at any time via the setup form or by calling `DELETE /api/students/:id`.
- This is not an official Virtual University service. It is intended for personal use by a small, known group of students.
