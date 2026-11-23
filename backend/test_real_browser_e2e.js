'use strict';
const puppeteer = require('puppeteer-core');
const assert = require('assert');
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5000';

const TEST_USER = {
  name: 'Dr. Real E2E Librarian',
  email: `e2e.librarian.${Date.now()}@crescent.education`,
  staffId: `LIB-E2E-${Date.now().toString().slice(-6)}`,
  password: 'CrescentAuth@2026!',
};

const results = [];

function record(step, expected, actual, passed) {
  results.push({ step, expected, actual, status: passed ? 'PASS' : 'FAIL' });
  const icon = passed ? '✓ [PASS]' : '❌ [FAIL]';
  console.log(`\n${icon} Step: ${step}`);
  console.log(`   Expected : ${expected}`);
  console.log(`   Actual   : ${actual}`);
}

async function runRealBrowserVerification() {
  console.log('============================================================');
  console.log('🌐  Real Browser End-to-End Authentication Verification');
  console.log('============================================================');
  console.log(`Target Application: ${APP_URL}`);
  console.log(`Chrome Binary     : ${CHROME_PATH}`);
  console.log(`Test Email        : ${TEST_USER.email}`);
  console.log(`Test Staff ID     : ${TEST_USER.staffId}`);

  let browser = null;

  try {
    // Launch real Chrome browser in headless mode
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => console.log(`[BROWSER CONSOLE ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.error('[BROWSER UNCAUGHT ERROR]', err.message));

    const networkRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        networkRequests.push({ method: req.method(), url: req.url() });
      }
    });

    const networkResponses = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/')) {
        let body = null;
        try {
          body = await res.json();
        } catch (_) {}
        networkResponses.push({ status: res.status(), url: res.url(), body });
      }
    });

    // Helper to safely clear and type into inputs
    async function setInput(selector, value) {
      await page.waitForSelector(selector);
      await page.$eval(selector, (el) => (el.value = ''));
      await page.type(selector, value);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Open the registration page
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 1: Open registration page ---');
    await page.goto(`${APP_URL}/#/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#af', { timeout: 5000 });

    const titleText = await page.$eval('h1', (el) => el.textContent.trim());
    const regFormExists = (await page.$('#name')) && (await page.$('#email')) && (await page.$('#pw')) && (await page.$('#pw2'));
    record(
      '1. Open Registration Page',
      'Display registration form with name, email, staffId, pw, pw2 fields',
      `Header: "${titleText}", All input fields present: ${Boolean(regFormExists)}`,
      Boolean(regFormExists) && titleText.includes('Create Librarian Account')
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Register a new test librarian using a unique institutional email & Staff ID
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 2: Register new test librarian ---');
    await setInput('#name', TEST_USER.name);
    await setInput('#email', TEST_USER.email);
    await setInput('#staffId', TEST_USER.staffId);
    await setInput('#pw', TEST_USER.password);
    await setInput('#pw2', TEST_USER.password);

    const formValues = await page.evaluate(() => ({
      name: document.querySelector('#name')?.value,
      email: document.querySelector('#email')?.value,
      staffId: document.querySelector('#staffId')?.value,
    }));
    record(
      '2. Fill Registration Details',
      `Form filled with ${TEST_USER.email} and ${TEST_USER.staffId}`,
      `Form fields populated: ${JSON.stringify(formValues)}`,
      formValues.email === TEST_USER.email && formValues.staffId === TEST_USER.staffId
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Verify that registration request reaches the backend
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 3: Submit registration and inspect network ---');
    const [regHttpRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/register'), { timeout: 8000 }),
      page.click('#sb'),
    ]);

    const regStatus = regHttpRes.status();
    const regBody = await regHttpRes.json().catch(() => ({}));
    record(
      '3. Registration Request Reaches Backend',
      'POST /auth/register reaches backend and returns HTTP 201 Created',
      `Backend responded HTTP ${regStatus}: ${regBody ? regBody.message : ''}`,
      regStatus === 201
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Verify that the database contains the newly created account
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 4: Verify database record in MongoDB ---');
    await mongoose.connect(process.env.MONGODB_URI);
    const dbUser = await User.findOne({ email: TEST_USER.email }).select('+password');
    record(
      '4. Database Contains New Account',
      `MongoDB record found with email ${TEST_USER.email}`,
      `Found user in Atlas: Name: "${dbUser ? dbUser.name : 'null'}", Staff ID: "${dbUser ? dbUser.staffId : 'null'}"`,
      Boolean(dbUser && dbUser.email === TEST_USER.email && dbUser.staffId === TEST_USER.staffId)
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Verify that password is stored as a secure hash, never plaintext
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 5: Verify password hash security in database ---');
    const isBcrypt = Boolean(dbUser && dbUser.password && dbUser.password.startsWith('$2'));
    const isNotPlain = Boolean(dbUser && dbUser.password !== TEST_USER.password);
    record(
      '5. Password Stored as Secure Hash',
      'Password stored as bcrypt hash ($2...), never plaintext',
      `Stored hash starts with: "${dbUser ? dbUser.password.slice(0, 7) : ''}...", Exact match with plaintext: ${!isNotPlain}`,
      isBcrypt && isNotPlain
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 6. Navigate to the login page
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 6: Navigate to login page ---');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.hash = '#/login';
    });

    await page.waitForSelector('#af', { timeout: 5000 });
    const loginHeader = await page.$eval('h1', (el) => el.textContent.trim());
    record(
      '6. Navigate to Login Page',
      'Display login form with email and password inputs',
      `Header: "${loginHeader}", Form displayed: true`,
      loginHeader.includes('Welcome Back') || loginHeader.includes('Librarian Sign In')
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 7. Log in using the newly registered account
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 7: Log in using newly registered account ---');
    await setInput('#email', TEST_USER.email);
    await setInput('#pw', TEST_USER.password);

    const loginInputs = await page.evaluate(() => ({
      email: document.querySelector('#email')?.value,
      pwLength: document.querySelector('#pw')?.value.length,
    }));

    const [loginHttpRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }),
      page.click('#sb'),
    ]);

    record(
      '7. Submit Login Request',
      `Credentials submitted for ${TEST_USER.email}`,
      `Input filled: ${loginInputs.email}, Password length: ${loginInputs.pwLength}, Request dispatched`,
      loginInputs.email === TEST_USER.email && loginInputs.pwLength > 0
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 8. Verify that authentication succeeds
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 8: Verify login succeeds ---');
    const loginStatus = loginHttpRes.status();
    await page.waitForFunction(() => Boolean(window.localStorage.getItem('clms_token')), { timeout: 8000 });
    const storedToken = await page.evaluate(() => localStorage.getItem('clms_token'));
    record(
      '8. Authentication Succeeds',
      'POST /auth/login returns HTTP 200 with JWT token stored in browser session',
      `Login HTTP ${loginStatus}, JWT token exists: ${Boolean(storedToken)}`,
      loginStatus === 200 && Boolean(storedToken)
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 9. Verify that the librarian dashboard opens
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 9: Verify dashboard opens ---');
    await page.waitForSelector('.hd, .ph', { timeout: 8000 });
    const pageText = await page.evaluate(() => document.body.innerText);
    const dashboardGreeting = pageText.includes(TEST_USER.name) || pageText.includes('Central Library inventory');
    record(
      '9. Librarian Dashboard Opens',
      `Dashboard renders greeting containing "${TEST_USER.name}"`,
      `Dashboard rendered successfully: ${dashboardGreeting}`,
      dashboardGreeting
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 10. Refresh the dashboard and verify authenticated session persists
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 10: Refresh dashboard and verify session persistence ---');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.hd, .ph', { timeout: 8000 });

    const postReloadToken = await page.evaluate(() => localStorage.getItem('clms_token'));
    const postReloadText = await page.evaluate(() => document.body.innerText);
    const postReloadSuccess = Boolean(postReloadToken) && (postReloadText.includes(TEST_USER.name) || postReloadText.includes('Catalog Titles'));
    record(
      '10. Refresh Dashboard Session Persistence',
      'Page reload maintains authenticated JWT session without redirect to login',
      `Session persisted: ${postReloadSuccess}, Token valid: ${Boolean(postReloadToken)}`,
      postReloadSuccess
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 11. Log out
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 11: Log out ---');
    await page.evaluate(() => {
      doLogout();
    });
    await page.waitForSelector('#af', { timeout: 5000 });

    const postLogoutToken = await page.evaluate(() => localStorage.getItem('clms_token'));
    const currentHash = await page.evaluate(() => window.location.hash);
    record(
      '11. Log Out',
      'Session wiped and user redirected to #/login',
      `Current URL hash: "${currentHash}", localStorage token cleared: ${postLogoutToken === null}`,
      currentHash.includes('login') && postLogoutToken === null
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 12. Attempt login with an incorrect password and verify that it is rejected
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 12: Attempt login with incorrect password ---');
    await setInput('#email', TEST_USER.email);
    await setInput('#pw', 'CompletelyWrongPassword@999');

    const [badLoginRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 8000 }),
      page.click('#sb'),
    ]);

    const badStatus = badLoginRes.status();
    await page.waitForFunction(() => {
      const errEl = document.querySelector('#e_pw');
      return errEl && errEl.textContent.length > 0;
    }, { timeout: 5000 });

    const pwErrorText = await page.$eval('#e_pw', (el) => el.textContent.trim());
    const preservedEmail = await page.$eval('#email', (el) => el.value);
    record(
      '12. Reject Incorrect Password',
      'HTTP 401 returned, error displayed, and email preserved in input field',
      `HTTP status: ${badStatus}, Error text: "${pwErrorText}", Preserved email: "${preservedEmail}"`,
      badStatus === 401 && preservedEmail === TEST_USER.email && pwErrorText.includes('Invalid')
    );

    // ──────────────────────────────────────────────────────────────────────────
    // 13. Attempt registration with the same email and verify duplicate prevention
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 13: Attempt duplicate registration ---');
    await page.goto(`${APP_URL}/#/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#af');

    await setInput('#name', 'Dr. Duplicate Impersonator');
    await setInput('#email', TEST_USER.email);
    await setInput('#staffId', 'LIB-DUP-9999');
    await setInput('#pw', 'AnotherPassword@123');
    await setInput('#pw2', 'AnotherPassword@123');

    const [dupRegRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/register'), { timeout: 8000 }),
      page.click('#sb'),
    ]);

    const dupStatus = dupRegRes.status();
    await page.waitForFunction(() => {
      const errEmail = document.querySelector('#e_email');
      return errEmail && errEmail.textContent.length > 0;
    }, { timeout: 5000 });

    const dupEmailErr = await page.$eval('#e_email', (el) => el.textContent.trim());
    record(
      '13. Duplicate Registration Prevented',
      'HTTP 409 Conflict returned and duplicate error displayed with sign-in link',
      `HTTP status: ${dupStatus}, Error text: "${dupEmailErr}"`,
      dupStatus === 409 && dupEmailErr.includes('already exists')
    );

    // Clean up test user
    await User.deleteOne({ email: TEST_USER.email });
    console.log(`\nCleaned up test record for ${TEST_USER.email}`);

    await mongoose.disconnect();
    await browser.close();

    console.log('\n============================================================');
    console.log(`🎉  All ${results.length} E2E Workflow Steps Completed!`);
    console.log('============================================================');
    console.table(results);

    const allPassed = results.every((r) => r.status === 'PASS');
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('\n❌ E2E Execution Error:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runRealBrowserVerification();
