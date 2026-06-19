/**
 * parser.js — DOM scraping helpers for VU LMS pages.
 *
 * Strategy:
 *   1. Try known default CSS selectors (updated from real-world LMS inspection).
 *   2. Fall back to a keyword/heuristic scanner that searches ALL table rows
 *      for recognizable terms and date patterns — resilient to layout changes.
 *   3. Custom selectors from settings override defaults when provided.
 *
 * NOTE FOR MAINTAINERS:
 *   If VULMS changes its HTML structure, open DevTools → Inspector on the
 *   assignments/quizzes/GDB listing page and update DEFAULT_SELECTORS below,
 *   OR use the Custom Selectors panel in the extension's Options page.
 */

// ─── Default CSS Selectors ────────────────────────────────────────────────────
// These reflect common ASP.NET WebForms / MVC patterns used in VULMS.
// Update these via Options page if the site changes.
const DEFAULT_SELECTORS = {
  // Assignments page: vulms.vu.edu.pk/Assignment/ListAssignments.aspx
  assignment: {
    rows:     'table tr, .assignment-row, [id*="Assignment"]',
    title:    'td:nth-child(2), .title, [id*="Title"]',
    deadline: 'td:nth-child(4), td:nth-child(5), [id*="Due"], [id*="Date"]',
    status:   'td:nth-child(6), .status, [id*="Status"]',
    link:     'a[href*="Assignment"], a[href*="assignment"]',
    course:   'td:nth-child(1), [id*="Course"]',
  },
  // Quizzes page: vulms.vu.edu.pk/Quiz/ListQuizzes.aspx
  quiz: {
    rows:     'table tr, .quiz-row, [id*="Quiz"]',
    title:    'td:nth-child(2), .title, [id*="Title"]',
    deadline: 'td:nth-child(4), td:nth-child(5), [id*="EndDate"], [id*="Due"]',
    status:   'td:nth-child(6), .status, [id*="Status"]',
    link:     'a[href*="Quiz"], a[href*="quiz"]',
    course:   'td:nth-child(1), [id*="Course"]',
  },
  // GDB page: vulms.vu.edu.pk/GDB/ListGDB.aspx
  gdb: {
    rows:     'table tr, .gdb-row, [id*="GDB"]',
    title:    'td:nth-child(2), .title, [id*="Title"]',
    deadline: 'td:nth-child(4), td:nth-child(5), [id*="Due"], [id*="Date"]',
    status:   'td:nth-child(6), .status, [id*="Status"]',
    link:     'a[href*="GDB"], a[href*="gdb"]',
    course:   'td:nth-child(1), [id*="Course"]',
  }
};

// ─── Date Parsing ─────────────────────────────────────────────────────────────
/**
 * Tries to parse a date string from common VU LMS formats.
 * Examples: "25-Jun-2026 11:59 PM", "June 25, 2026", "2026-06-25"
 * @param {string} text
 * @returns {Date|null}
 */
function parseDeadlineText(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();

  // Format: "25-Jun-2026 11:59 PM" or "25-Jun-2026"
  const dmyMatch = cleaned.match(/(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm))?/);
  if (dmyMatch) {
    const [, day, mon, year, hr, min, ampm] = dmyMatch;
    let hours = hr ? parseInt(hr) : 23;
    if (ampm) {
      const ap = ampm.toUpperCase();
      if (ap === 'PM' && hours !== 12) hours += 12;
      if (ap === 'AM' && hours === 12) hours = 0;
    }
    const minutes = min ? parseInt(min) : 59;
    const d = new Date(`${mon} ${day}, ${year} ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00`);
    if (!isNaN(d)) return d;
  }

  // Format: "June 25, 2026" or "Jun 25 2026"
  const mdyMatch = cleaned.match(/(\w{3,9})\s+(\d{1,2})[,\s]+(\d{4})/);
  if (mdyMatch) {
    const d = new Date(`${mdyMatch[1]} ${mdyMatch[2]}, ${mdyMatch[3]} 23:59:00`);
    if (!isNaN(d)) return d;
  }

  // ISO format: "2026-06-25"
  const isoMatch = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1] + 'T23:59:00');
    if (!isNaN(d)) return d;
  }

  // Try direct parse as last resort
  const direct = new Date(cleaned);
  if (!isNaN(direct)) return direct;

  return null;
}

// ─── Unique ID Generator ──────────────────────────────────────────────────────
/**
 * Generates a stable unique key for an item.
 * Prefers using the href, falls back to a hash of course+type+title.
 */
function generateItemId(type, courseCode, title, url) {
  if (url) {
    // Extract meaningful part of URL
    const match = url.match(/[?&](id|ID|assignmentId|quizId|gdbId|itemId)=([^&]+)/);
    if (match) return `${type}-${match[2]}`;
  }
  // Hash-like fallback using string components
  const raw = `${type}-${courseCode}-${title}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  return raw.substring(0, 80);
}

// ─── Status Detection ─────────────────────────────────────────────────────────
/**
 * Determines submission status from a status cell's text content.
 * @param {string} statusText
 * @returns {'submitted'|'pending'}
 */
function parseStatus(statusText) {
  if (!statusText) return 'pending';
  const t = statusText.toLowerCase().trim();
  if (
    t.includes('submitted') || t.includes('graded') ||
    t.includes('checked')  || t.includes('reviewed') ||
    t.includes('closed')   || t.includes('saved')
  ) {
    return 'submitted';
  }
  return 'pending';
}

// ─── Page Type Detection ──────────────────────────────────────────────────────
/**
 * Detects item type from current page URL or page content.
 * @param {Document} doc
 * @returns {'assignment'|'quiz'|'gdb'|null}
 */
function detectPageType(doc) {
  const url = doc.location ? doc.location.href.toLowerCase() : '';
  if (url.includes('assignment')) return 'assignment';
  if (url.includes('quiz'))       return 'quiz';
  if (url.includes('gdb'))        return 'gdb';

  // Check page title / heading as fallback
  const heading = (doc.title || '') + ' ' + (doc.querySelector('h1,h2,h3')?.textContent || '');
  const h = heading.toLowerCase();
  if (h.includes('assignment')) return 'assignment';
  if (h.includes('quiz'))       return 'quiz';
  if (h.includes('gdb') || h.includes('graded discussion')) return 'gdb';

  return null;
}

// ─── Heuristic Row Scanner ────────────────────────────────────────────────────
// DATE_PATTERN matches most date formats used by VU LMS
const DATE_PATTERN = /\d{1,2}[\/\-]\w{2,9}[\/\-]\d{2,4}|\w{3,9}\s+\d{1,2}[,\s]+\d{4}|\d{4}-\d{2}-\d{2}/i;

/**
 * Fallback scanner — walks all table rows looking for date + keyword signals.
 * Returns an array of raw extracted data objects.
 * @param {Document} doc
 * @param {string} defaultType
 * @returns {Array<Object>}
 */
function heuristicScan(doc, defaultType) {
  const results = [];
  const rows = doc.querySelectorAll('table tr, .row, li[class*="item"]');

  rows.forEach(row => {
    const text = row.innerText || row.textContent || '';
    if (!DATE_PATTERN.test(text)) return; // Skip rows with no date

    // Find all cells
    const cells = row.querySelectorAll('td, th, span, div');
    if (cells.length < 2) return;

    let title = '';
    let deadlineText = '';
    let statusText = '';
    let url = '';
    let courseCode = '';

    // Look for anchor with meaningful href
    const anchor = row.querySelector('a[href]');
    if (anchor) {
      url = anchor.href;
      if (!title) title = anchor.textContent.trim();
    }

    // Scan cells for dates and text
    cells.forEach(cell => {
      const cellText = (cell.innerText || cell.textContent || '').trim();
      if (DATE_PATTERN.test(cellText) && !deadlineText) {
        deadlineText = cellText;
      }
      if (/submitted|graded|pending|closed|open/i.test(cellText)) {
        statusText = cellText;
      }
      if (/^[A-Z]{2,5}\d{3}$/i.test(cellText.trim())) {
        courseCode = cellText.trim().toUpperCase();
      }
    });

    // Determine type from row text or URL
    let type = defaultType || 'assignment';
    const tl = text.toLowerCase();
    if (tl.includes('quiz'))       type = 'quiz';
    if (tl.includes('gdb') || tl.includes('discussion')) type = 'gdb';
    if (tl.includes('assignment')) type = 'assignment';

    const deadline = parseDeadlineText(deadlineText);
    if (!deadline || !title) return; // Skip incomplete rows

    results.push({
      type,
      title,
      courseCode: courseCode || 'Unknown',
      deadline,
      statusText,
      url: url || doc.location?.href || '',
    });
  });

  return results;
}

// ─── Selector-Based Parser ────────────────────────────────────────────────────
/**
 * Parses items from the page using provided selectors.
 * @param {Document} doc
 * @param {string} type - item type
 * @param {Object} selectors - CSS selectors object
 * @param {string} pageUrl - page URL for fallback
 * @returns {Array<Object>}
 */
function parseWithSelectors(doc, type, selectors, pageUrl) {
  const results = [];
  const rows = doc.querySelectorAll(selectors.rows);

  rows.forEach(row => {
    try {
      const titleEl    = row.querySelector(selectors.title);
      const deadlineEl = row.querySelector(selectors.deadline);
      const statusEl   = row.querySelector(selectors.status);
      const courseEl   = row.querySelector(selectors.course);
      const linkEl     = row.querySelector(selectors.link) || row.querySelector('a[href]');

      const title       = (titleEl?.innerText || titleEl?.textContent || '').trim();
      const deadlineRaw = (deadlineEl?.innerText || deadlineEl?.textContent || '').trim();
      const statusRaw   = (statusEl?.innerText   || statusEl?.textContent   || '').trim();
      const courseRaw   = (courseEl?.innerText   || courseEl?.textContent   || '').trim();
      const url         = linkEl?.href || pageUrl;

      if (!title || !deadlineRaw) return;

      const deadline = parseDeadlineText(deadlineRaw);
      if (!deadline) return;

      const courseCode = (/^[A-Z]{2,5}\d{3}/i.test(courseRaw) ? courseRaw.trim().toUpperCase() : null) || 'Unknown';

      results.push({ type, title, courseCode, deadline, statusText: statusRaw, url });
    } catch (e) {
      // Skip malformed rows silently
    }
  });

  return results;
}

// ─── Main Export Function ─────────────────────────────────────────────────────
/**
 * Main entry: parse the current document for LMS items.
 * @param {Document} doc - the page document
 * @param {Object|null} customSelectors - optional overrides from settings
 * @returns {Array<Object>} normalized item array ready for background.js
 */
function parseLMSPage(doc, customSelectors) {
  const now = new Date().toISOString();
  const pageUrl = doc.location?.href || '';
  const pageType = detectPageType(doc);

  let rawItems = [];

  // Try selector-based parse for all three types
  ['assignment', 'quiz', 'gdb'].forEach(type => {
    // Merge custom overrides on top of defaults
    const selectors = Object.assign(
      {},
      DEFAULT_SELECTORS[type],
      customSelectors && customSelectors[type] ? customSelectors[type] : {}
    );

    const found = parseWithSelectors(doc, type, selectors, pageUrl);
    rawItems = rawItems.concat(found);
  });

  // If selector-based parse found nothing, run heuristic scan
  if (rawItems.length === 0) {
    rawItems = heuristicScan(doc, pageType);
  }

  // Normalize and deduplicate
  const seen = new Set();
  const items = [];

  rawItems.forEach(raw => {
    const status = parseStatus(raw.statusText);
    const id = generateItemId(raw.type, raw.courseCode, raw.title, raw.url);

    if (seen.has(id)) return;
    seen.add(id);

    items.push({
      id,
      type:        raw.type,
      title:       raw.title,
      courseCode:  raw.courseCode,
      deadline:    raw.deadline.toISOString(),
      status,
      url:         raw.url,
      firstSeenAt: now,
    });
  });

  return items;
}
