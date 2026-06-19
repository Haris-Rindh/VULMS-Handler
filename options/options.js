/**
 * options.js — Settings page controller for VU LMS Deadline Notifier.
 * Loads stored settings, binds UI controls, saves on "Save Settings".
 */

'use strict';

const DEFAULT_SETTINGS = {
  preset:           'normal',
  checkInterval:    30,
  quietHoursStart:  '23:00',
  quietHoursEnd:    '07:00',
  quietHoursEnabled: true,
  soundEnabled:     true,
  customSelectors:  null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const presetValue        = document.getElementById('preset-value');
const presetNormal       = document.getElementById('preset-normal');
const presetAggressive   = document.getElementById('preset-aggressive');
const checkInterval      = document.getElementById('check-interval');
const soundEnabled       = document.getElementById('sound-enabled');
const quietHoursEnabled  = document.getElementById('quiet-hours-enabled');
const quietStart         = document.getElementById('quiet-start');
const quietEnd           = document.getElementById('quiet-end');
const saveStatus         = document.getElementById('save-status');
const btnSave            = document.getElementById('btn-save');
const btnReset           = document.getElementById('btn-reset');

// Selector overrides
const selFields = {
  'sel-asgn-rows':    ['assignment', 'rows'],
  'sel-asgn-title':   ['assignment', 'title'],
  'sel-asgn-dead':    ['assignment', 'deadline'],
  'sel-asgn-status':  ['assignment', 'status'],
  'sel-quiz-rows':    ['quiz', 'rows'],
  'sel-quiz-dead':    ['quiz', 'deadline'],
  'sel-gdb-rows':     ['gdb', 'rows'],
  'sel-gdb-dead':     ['gdb', 'deadline'],
};

// ─── Preset Button Logic ──────────────────────────────────────────────────────
presetNormal.addEventListener('click', () => setPreset('normal'));
presetAggressive.addEventListener('click', () => setPreset('aggressive'));

function setPreset(value) {
  presetValue.value = value;
  presetNormal.classList.toggle('active', value === 'normal');
  presetAggressive.classList.toggle('active', value === 'aggressive');
}

// ─── Load Settings ────────────────────────────────────────────────────────────
async function loadSettings() {
  const result = await chrome.storage.local.get(['settings']);
  const s = Object.assign({}, DEFAULT_SETTINGS, result.settings || {});

  setPreset(s.preset || 'normal');
  checkInterval.value        = s.checkInterval    ?? 30;
  soundEnabled.checked       = s.soundEnabled     ?? true;
  quietHoursEnabled.checked  = s.quietHoursEnabled ?? true;
  quietStart.value           = s.quietHoursStart  || '23:00';
  quietEnd.value             = s.quietHoursEnd    || '07:00';

  // Populate custom selectors
  const cs = s.customSelectors || {};
  Object.entries(selFields).forEach(([elId, [type, field]]) => {
    const el = document.getElementById(elId);
    if (el) el.value = cs[type]?.[field] || '';
  });
}

// ─── Gather Settings from UI ──────────────────────────────────────────────────
function gatherSettings() {
  // Build custom selectors object (only non-empty values)
  const customSelectors = {};
  Object.entries(selFields).forEach(([elId, [type, field]]) => {
    const el  = document.getElementById(elId);
    const val = el?.value?.trim();
    if (val) {
      if (!customSelectors[type]) customSelectors[type] = {};
      customSelectors[type][field] = val;
    }
  });

  return {
    preset:            presetValue.value,
    checkInterval:     Math.max(5, Math.min(120, parseInt(checkInterval.value) || 30)),
    soundEnabled:      soundEnabled.checked,
    quietHoursEnabled: quietHoursEnabled.checked,
    quietHoursStart:   quietStart.value,
    quietHoursEnd:     quietEnd.value,
    customSelectors:   Object.keys(customSelectors).length > 0 ? customSelectors : null,
  };
}

// ─── Save ─────────────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const settings = gatherSettings();
  await chrome.storage.local.set({ settings });

  // Notify background to re-set up alarm with new interval
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});

  // Show feedback
  saveStatus.textContent = '✓ Settings saved!';
  saveStatus.classList.remove('hidden');
  saveStatus.classList.add('success');
  btnSave.textContent = '✓ Saved';
  setTimeout(() => {
    saveStatus.classList.add('hidden');
    btnSave.textContent = 'Save Settings';
  }, 2500);
});

// ─── Reset ────────────────────────────────────────────────────────────────────
btnReset.addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults? This will not delete tracked items.')) return;
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});
  await loadSettings();
  saveStatus.textContent = '✓ Reset to defaults';
  saveStatus.classList.remove('hidden');
  saveStatus.classList.add('success');
  setTimeout(() => saveStatus.classList.add('hidden'), 2500);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSettings();
