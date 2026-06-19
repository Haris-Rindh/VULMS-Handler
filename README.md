# VU LMS Deadline Notifier 🔔

A Chrome extension (Manifest V3) that automatically detects Virtual University of Pakistan LMS **assignments**, **quizzes**, and **GDBs** from your logged-in browser session, and sends escalating reminders as deadlines approach.

> **Zero credential storage** — the extension only uses your existing browser session. No password is ever stored or transmitted.

---

## Features

| Feature | Detail |
|---|---|
| 🔍 Auto-detection | Scans VULMS pages for assignments, quizzes, GDBs on every visit |
| 🔔 Instant notification | Fires immediately when a new item is found |
| ⏰ Escalating reminders | Gets more frequent as deadline nears (see schedule below) |
| 🚨 Critical mode | Last 6 hours: persistent non-dismissable popup + chime |
| 🌙 Quiet Hours | Suppresses reminders during your sleep window |
| ✓ Auto-stop | Stops notifying once you submit (or mark manually as submitted) |
| 🎨 Premium popup | Live countdown timers, urgency color coding, filter tabs |
| ⚙️ Settings page | Presets, quiet hours, custom DOM selectors for resilience |

---

## Notification Schedule

| Time Before Deadline | Frequency |
|---|---|
| Detected (new) | Immediate |
| > 72 hours | Every 24 hours |
| 24–72 hours | Every 6 hours |
| 6–24 hours | Every 2 hours |
| < 6 hours | Every 30 min, sound alert, non-dismissable |
| Deadline passed | One final "Missed" notification, then stops |

---

## Installation (Unpacked / Developer)

1. **Download / clone** this folder to your computer.
2. Open Chrome and navigate to **`chrome://extensions`**.
3. Enable **Developer Mode** (top-right toggle).
4. Click **"Load unpacked"** and select the `Assignment detector` folder.
5. The extension icon will appear in your toolbar. Pin it for quick access.
6. **Log into** [vulms.vu.edu.pk](https://vulms.vu.edu.pk) — the extension activates automatically.

---

## Testing Without a Real VULMS Login

A mock LMS page is included for local development and testing:

```
test/mock_lms.html
```

To test with the content script:
1. Temporarily add `"file:///*"` or `"*://localhost/*"` to `host_permissions` in `manifest.json`.
2. Also update the `content_scripts.matches` array to include the file URL.
3. Open `test/mock_lms.html` in Chrome as a file (`file:///...`).
4. Open the extension popup — items should appear immediately.

> **Revert** the manifest changes before submitting to the Chrome Web Store.

---

## Updating DOM Selectors (If VULMS Changes Layout)

If the LMS updates its HTML and the extension stops detecting items:

1. Click the extension icon → **Settings (⚙️)**.
2. Scroll to **Custom DOM Selectors**.
3. Open DevTools on the VULMS assignments/quizzes/GDB page.
4. Right-click an assignment row → **Inspect** → copy the CSS selector.
5. Paste into the relevant field and click **Save Settings**.

---

## File Structure

```
Assignment detector/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker: scheduling, diffing, notifications
├── content.js             # Injected on VULMS pages: scrapes & sends data
├── popup/
│   ├── popup.html         # Toolbar popup UI
│   ├── popup.css          # Dark glassmorphism styles
│   └── popup.js           # Live countdown, filter tabs, actions
├── options/
│   ├── options.html       # Settings page
│   ├── options.css
│   └── options.js
├── utils/
│   ├── parser.js          # DOM parser + heuristic fallback
│   ├── scheduler.js       # Escalation intervals, quiet hours, urgency
│   ├── audio.html         # Offscreen document for chime playback
│   └── audio.js           # Web Audio API chime generator
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── test/
    └── mock_lms.html      # Local HTML page simulating VULMS for testing
```

---

## Privacy

- **No data leaves your browser.** All state is stored in `chrome.storage.local`.
- **No passwords stored.** The extension reads only pages you're already authorized to see.
- **Host permissions** are restricted to `vulms.vu.edu.pk` and `vu.edu.pk` only.

---

## Phase 2 Roadmap

- Mobile push notifications via Firebase Cloud Messaging + Flutter app
- Email digest (weekly summary)
- Multi-device sync via `chrome.storage.sync`
- GPA calculator integration
