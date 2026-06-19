/**
 * sw.js — Service Worker for VU LMS Notifier PWA.
 *
 * Responsibilities:
 *  1. Receive push events from the backend → show a notification
 *  2. Handle notification clicks → open the relevant LMS URL
 *  3. Basic offline caching of the setup form shell
 */

'use strict';

const CACHE_NAME = 'vu-notifier-v1';
const SHELL_FILES = ['/', '/index.html'];

// ── Install: cache the app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fall back to network ────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Push: receive and display notification ────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (_) {
    data = { title: 'VU LMS Notifier', body: event.data.text(), url: 'https://vulms.vu.edu.pk' };
  }

  const { title, body, url, icon, badge, tag, requireInteraction } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:               icon  || '/icons/icon128.png',
      badge:              badge || '/icons/icon48.png',
      tag:                tag   || 'vu-notifier',
      requireInteraction: requireInteraction || false,
      data:               { url: url || 'https://vulms.vu.edu.pk' },
    })
  );
});

// ── Notification click: open the LMS URL ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || 'https://vulms.vu.edu.pk';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Reuse an existing tab if one already has the LMS open
      const existing = windowClients.find(c => c.url.startsWith('https://vulms.vu.edu.pk'));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
