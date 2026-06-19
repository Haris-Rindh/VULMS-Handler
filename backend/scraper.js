/**
 * scraper.js — Playwright-based VU LMS login + item scraping.
 *
 * Exports a single function: scrapeStudent(studentId, password)
 * Returns an array of normalised item objects ready for diffing in scheduler.js.
 *
 * NOTE: Selectors here are based on the real VU LMS HTML inspected on
 * 2026-06-19. If the LMS layout changes, update the SELECTORS object below.
 */

'use strict';

const { chromium } = require('playwright');

// ─── URLs ─────────────────────────────────────────────────────────────────────
const LOGIN_URL       = 'https://vulms.vu.edu.pk/LMS_LP.aspx';
const HOME_URL_PREFIX = 'https://vulms.vu.edu.pk/Home.aspx';

// Pages to scrape per item type.
// We'll navigate to each one after login and parse tables.
// TODO: fill in the real paths after you inspect each page post-login.
// For now these are placeholder paths you'll confirm after the spike.
const PAGES = {
  assignment: 'https://vulms.vu.edu.pk/Assignment/ListAssignments.aspx',
  quiz:       'https://vulms.vu.edu.pk/Quiz/ListQuizzes.aspx',
  gdb:        'https://vulms.vu.edu.pk/GDB/ListGDB.aspx',
};

// ─── Selectors ────────────────────────────────────────────────────────────────
// Update these after inspecting the real LMS pages.
// Each entry: { rows, title, deadline, status, course, link }
const SELECTORS = {
  assignment: {
    rows:     'table tr:not(:first-child)',   // skip header row
    title:    'td:nth-child(2)',
    deadline: 'td:nth-child(4)',
    status:   'td:nth-child(6)',
    course:   'td:nth-child(1)',
    link:     'td:nth-child(2) a',
  },
  quiz: {
    rows:     'table tr:not(:first-child)',
    title:    'td:nth-child(2)',
    deadline: 'td:nth-child(4)',
    status:   'td:nth-child(6)',
    course:   'td:nth-child(1)',
    link:     'td:nth-child(2) a',
  },
  gdb: {
    rows:     'table tr:not(:first-child)',
    title:    'td:nth-child(2)',
    deadline: 'td:nth-child(4)',
    status:   'td:nth-child(5)',
    course:   'td:nth-child(1)',
    link:     'td:nth-child(2) a',
  },
};

const TIMEOUT = 30_000;

// ─── Date Parsing (ported from v1 parser.js) ──────────────────────────────────
const DATE_PATTERN = /(\d{1,2})[\/\-](\w{3,9})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm))?/;

function parseDeadline(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();

  const m = t.match(DATE_PATTERN);
  if (m) {
    const [, day, mon, year, hr, min, ampm] = m;
    let hours = hr ? parseInt(hr, 10) : 23;
    if (ampm) {
      const ap = ampm.toUpperCase();
      if (ap === 'PM' && hours !== 12) hours += 12;
      if (ap === 'AM' && hours === 12) hours = 0;
    }
    const minutes = min ? parseInt(min, 10) : 59;
    const d = new Date(`${mon} ${day}, ${year} ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00`);
    if (!isNaN(d)) return d;
  }

  const iso = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1] + 'T23:59:00');
    if (!isNaN(d)) return d;
  }

  const direct = new Date(t);
  return isNaN(direct) ? null : direct;
}

// ─── Status Detection ─────────────────────────────────────────────────────────
function parseStatus(text) {
  if (!text) return 'pending';
  const t = text.toLowerCase().trim();
  if (/submitted|graded|checked|reviewed|closed|saved|replied/.test(t)) return 'submitted';
  return 'pending';
}

// ─── Stable Item Key ──────────────────────────────────────────────────────────
function makeItemKey(type, courseCode, title, deadline) {
  return `${type}|${courseCode}|${title}|${deadline}`
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9|\-]/g, '')
    .substring(0, 120);
}

// ─── Parse a single listing page ──────────────────────────────────────────────
async function parseListingPage(page, type) {
  const sel = SELECTORS[type];
  const items = [];

  try {
    const rows = await page.locator(sel.rows).all();

    for (const row of rows) {
      try {
        const titleEl    = row.locator(sel.title);
        const deadlineEl = row.locator(sel.deadline);
        const statusEl   = row.locator(sel.status);
        const courseEl   = row.locator(sel.course);
        const linkEl     = row.locator(sel.link);

        const title       = (await titleEl.textContent().catch(() => '')).trim();
        const deadlineRaw = (await deadlineEl.textContent().catch(() => '')).trim();
        const statusRaw   = (await statusEl.textContent().catch(() => '')).trim();
        const courseRaw   = (await courseEl.textContent().catch(() => '')).trim();
        const linkHref    = await linkEl.getAttribute('href').catch(() => null);

        if (!title || !deadlineRaw) continue;

        const deadline = parseDeadline(deadlineRaw);
        if (!deadline) continue;

        const courseCode = /^[A-Z]{2,5}\d{3}/i.test(courseRaw.trim())
          ? courseRaw.trim().toUpperCase()
          : 'Unknown';

        const url = linkHref
          ? (linkHref.startsWith('http') ? linkHref : `https://vulms.vu.edu.pk${linkHref}`)
          : page.url();

        items.push({
          type,
          title,
          courseCode,
          deadline:  deadline.toISOString(),
          status:    parseStatus(statusRaw),
          url,
          itemKey:   makeItemKey(type, courseCode, title, deadline.toISOString()),
        });
      } catch (_) {
        // Skip malformed rows silently
      }
    }
  } catch (err) {
    console.warn(`[scraper] Could not parse ${type} page: ${err.message}`);
  }

  return items;
}

// ─── Main export ─────────────────────────────────────────────────────────────
/**
 * Logs into VULMS and scrapes all assignments, quizzes, and GDBs.
 *
 * @param {string} studentId   — plain text VU student ID
 * @param {string} password    — plain text password (decrypted in scheduler.js)
 * @returns {Promise<Array>}   — array of normalised item objects
 */
async function scrapeStudent(studentId, password) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // needed on Linux VMs
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport:  { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // ── Login ────────────────────────────────────────────────────────────────
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForSelector('#txtStudentID', { timeout: TIMEOUT });
    await page.fill('#txtStudentID', studentId);
    await page.fill('#txtPassword', password);

    await Promise.all([
      page.waitForURL(`${HOME_URL_PREFIX}**`, { timeout: TIMEOUT }),
      page.click('#ibtnLogin'),
    ]);

    console.log(`[scraper] ✅ Logged in: ${studentId}`);

    // ── Scrape each page ─────────────────────────────────────────────────────
    const allItems = [];

    for (const [type, url] of Object.entries(PAGES)) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        const items = await parseListingPage(page, type);
        console.log(`[scraper]    ${type}: ${items.length} item(s) found`);
        allItems.push(...items);
      } catch (err) {
        console.warn(`[scraper]    Could not load ${type} page: ${err.message}`);
      }
    }

    return allItems;

  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeStudent };
