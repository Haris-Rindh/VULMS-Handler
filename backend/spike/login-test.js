/**
 * login-test.js — VU LMS Playwright login spike.
 *
 * Proves that headless Chromium can log into VULMS end-to-end.
 * Reads credentials from .env — never hardcoded.
 *
 * Run:
 *   cp .env.example .env          # fill in your real credentials
 *   npm install
 *   npx playwright install chromium
 *   node login-test.js
 *
 * Expected output on success:
 *   ✅  Login successful
 *   📄  Page title: "Virtual University of Pakistan"
 *   🖼️   Screenshot saved → spike-screenshot.png
 */

'use strict';

const path     = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ─── Config ───────────────────────────────────────────────────────────────────
const LOGIN_URL      = 'https://vulms.vu.edu.pk/LMS_LP.aspx';
const POST_LOGIN_URL = 'https://vulms.vu.edu.pk/Home.aspx';  // URL prefix after login
const SCREENSHOT     = path.join(__dirname, 'spike-screenshot.png');
const TIMEOUT_MS     = 30_000; // 30 s — generous for a slow LMS

// ─── Credential check ─────────────────────────────────────────────────────────
const studentId = process.env.VU_STUDENT_ID;
const password  = process.env.VU_PASSWORD;

if (!studentId || !password) {
  console.error('❌  Missing credentials.');
  console.error('    Copy .env.example → .env and fill in VU_STUDENT_ID and VU_PASSWORD.');
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  let browser;

  try {
    console.log('🚀  Launching headless Chromium…');
    browser = await chromium.launch({
      headless: true,
      // Uncomment the next line to watch the browser live while debugging:
      // headless: false,
    });

    const context = await browser.newContext({
      // Mimic a real desktop browser to reduce bot-detection risk
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport:  { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // ── 1. Navigate to login page ───────────────────────────────────────────
    console.log(`🌐  Navigating to ${LOGIN_URL} …`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // ── 2. Confirm the login form is present ───────────────────────────────
    await page.waitForSelector('#txtStudentID', { timeout: TIMEOUT_MS });
    console.log('📋  Login form found.');

    // ── 3. Fill credentials ────────────────────────────────────────────────
    await page.fill('#txtStudentID', studentId);
    await page.fill('#txtPassword', password);
    console.log('✏️   Credentials entered.');

    // ── 4. Click Sign In ───────────────────────────────────────────────────
    // The button has onclick="return ValidateFields();" — clicking via
    // Playwright triggers the JS handler naturally, same as a real user click.
    console.log('🖱️   Clicking Sign In…');
    await Promise.all([
      page.waitForURL(`${POST_LOGIN_URL}**`, { timeout: TIMEOUT_MS }),
      page.click('#ibtnLogin'),
    ]);

    // ── 5. Confirm we landed on the dashboard ──────────────────────────────
    const currentUrl = page.url();
    const pageTitle  = await page.title();

    if (!currentUrl.startsWith(POST_LOGIN_URL)) {
      // Might be a wrong-password page — grab any visible error text
      const errText = await page.locator('span.error, .alert, .m-alert').textContent().catch(() => '(no error element found)');
      throw new Error(`Unexpected post-login URL: ${currentUrl}\nPage error text: ${errText.trim()}`);
    }

    console.log('\n✅  Login successful!');
    console.log(`📄  Page title : "${pageTitle}"`);
    console.log(`🔗  Current URL: ${currentUrl}`);

    // ── 6. Take a screenshot for visual confirmation ───────────────────────
    await page.screenshot({ path: SCREENSHOT, fullPage: false });
    console.log(`🖼️   Screenshot → ${SCREENSHOT}`);

    // ── 7. (Optional) read a piece of page content to confirm session ──────
    // Try to grab the student's name from the top-right corner / navbar.
    const welcomeText = await page.locator('text=/Welcome|Hello|Logged in/i').first().textContent().catch(() => null);
    if (welcomeText) {
      console.log(`👋  Welcome text: "${welcomeText.trim()}"`);
    }

    console.log('\n🎉  Spike complete — Playwright can log into VULMS headlessly.');

  } catch (err) {
    console.error('\n❌  Spike failed:');
    console.error('   ', err.message);
    process.exitCode = 1;

  } finally {
    if (browser) await browser.close();
  }
})();
