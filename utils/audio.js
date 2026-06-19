/**
 * audio.js — Offscreen document script for playing alert sounds.
 * Receives PLAY_SOUND messages from the background service worker.
 * Uses the Web Audio API to generate a synthetic chime (no external files needed).
 */

'use strict';

// ─── Synthetic Chime Generator ────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new AudioContext();

    // Three-note ascending chime: C5 → E5 → G5
    const notes = [523.25, 659.25, 783.99];
    let startTime = ctx.currentTime;

    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode   = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, startTime);

      // Envelope: quick attack, gentle decay
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.4, startTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

      oscillator.start(startTime);
      oscillator.stop(startTime + 0.65);

      startTime += 0.18;
    });

    // Close context after sound finishes
    setTimeout(() => ctx.close(), 2000);
  } catch (err) {
    console.error('[VU Notifier Audio]', err);
  }
}

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_SOUND') {
    playChime();
  }
});
