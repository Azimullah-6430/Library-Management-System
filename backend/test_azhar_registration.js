'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5000';

const AZHAR_USER = {
  name: 'Azhar',
  email: 'azhar4@crescent.education',
  staffId: '411',
  password: 'azhar@2011',
};

async function testAzharRegistration() {
  console.log('============================================================');
  console.log('🧪  Testing Real Registration for Azhar (azhar4@crescent.education)');
  console.log('============================================================\n');

  let browser = null;

  try {
    // 1. Connect to MongoDB to ensure account is ready to be created
    await mongoose.connect(process.env.MONGODB_URI);
    await User.deleteMany({ email: AZHAR_USER.email });
    await User.deleteMany({ staffId: AZHAR_USER.staffId });
    console.log('[1/5] MongoDB initialized; cleared any stale records.');

    // 2. Launch Chrome
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => console.log(`[BROWSER CONSOLE ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.error('[BROWSER ERROR]', err.message));

    // 3. Navigate to #/register
    console.log('\n[2/5] Navigating to Registration Page...');
    await page.goto(`${APP_URL}/#/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#af', { timeout: 6000 });

    async function setInput(selector, value) {
      await page.waitForSelector(selector);
      await page.$eval(selector, (el) => (el.value = ''));
      await page.type(selector, value);
    }

    console.log('[3/5] Filling registration form with user details:');
    console.log(`      Name: "${AZHAR_USER.name}"`);
    console.log(`      Email: "${AZHAR_USER.email}"`);
    console.log(`      Staff ID: "${AZHAR_USER.staffId}"`);

    await setInput('#name', AZHAR_USER.name);
    await setInput('#email', AZHAR_USER.email);
    await setInput('#staffId', AZHAR_USER.staffId);
    await setInput('#pw', AZHAR_USER.password);
    await setInput('#pw2', AZHAR_USER.password);

    console.log('\n[4/5] Clicking "Register Account" and inspecting network...');
    const [regResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/register'), { timeout: 10000 }),
      page.click('#sb'),
    ]);

    console.log(`      HTTP Status: ${regResponse.status()}`);
    const resData = await regResponse.json().catch(() => ({}));
    console.log(`      Server Message: "${resData.message || ''}"`);

    if (regResponse.status() !== 201) {
      throw new Error(`Registration failed with status ${regResponse.status()}: ${JSON.stringify(resData)}`);
    }

    // 4. Verify MongoDB record
    const dbUser = await User.findOne({ email: AZHAR_USER.email }).select('+password');
    if (!dbUser) {
      throw new Error('User record was not found in MongoDB!');
    }
    console.log(`\n[5/5] Verified in MongoDB Atlas:`);
    console.log(`      _id: ${dbUser._id}`);
    console.log(`      Name: ${dbUser.name}`);
    console.log(`      Email: ${dbUser.email}`);
    console.log(`      Staff ID: ${dbUser.staffId}`);
    console.log(`      Role: ${dbUser.role}`);
    console.log(`      Password Hash: ${dbUser.password.slice(0, 15)}... (Bcrypt securely hashed)`);

    // Wait for redirect to dashboard
    await page.waitForSelector('.hd, .ph', { timeout: 8000 });
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasGreeting = pageText.includes(AZHAR_USER.name) || pageText.includes('Central Library');
    console.log(`      Dashboard loaded: ${hasGreeting}`);

    // Now test signing out and signing back in with the new credentials
    console.log('\n[BONUS] Testing Sign In with Azhar credentials...');
    await page.evaluate(() => {
      doLogout();
    });
    await page.waitForSelector('#af', { timeout: 6000 });

    await setInput('#email', AZHAR_USER.email);
    await setInput('#pw', AZHAR_USER.password);

    const [loginRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 10000 }),
      page.click('#sb'),
    ]);

    console.log(`      Login HTTP Status: ${loginRes.status()}`);
    if (loginRes.status() !== 200) {
      throw new Error(`Login failed with status ${loginRes.status()}`);
    }

    await page.waitForSelector('.hd, .ph', { timeout: 8000 });
    console.log('      Login successful! Dashboard re-opened.');

    await browser.close();
    await mongoose.disconnect();

    console.log('\n============================================================');
    console.log('🎉  SUCCESS: Azhar account registered and verified permanently!');
    console.log('============================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test Error:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}

testAzharRegistration();
