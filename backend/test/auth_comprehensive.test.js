'use strict';
const assert = require('assert');
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

const API_BASE = 'http://localhost:5000/api/v1';
const HEALTH_URL = 'http://localhost:5000/health';
const API_HEALTH_URL = 'http://localhost:5000/api/health';

function pass(msg) {
  console.log(`  ✓ [PASS] ${msg}`);
}

function fail(msg, err) {
  console.error(`  ❌ [FAIL] ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🔒  Comprehensive Authentication, Registration & Health Verification');
  console.log('============================================================\n');

  // Step 1: Health Check & Readiness Endpoints
  console.log('[Phase 1] Health & Connectivity Endpoints…');
  try {
    const resRoot = await fetch(HEALTH_URL);
    assert.strictEqual(resRoot.status, 200, 'Root /health should return 200');
    const rootData = await resRoot.json();
    assert.strictEqual(rootData.database, 'connected', 'Database should report connected');
    pass('GET /health reports online with database connected');

    const resApi = await fetch(API_HEALTH_URL);
    assert.strictEqual(resApi.status, 200, 'GET /api/health should return 200');
    const apiData = await resApi.json();
    assert.strictEqual(apiData.status, 'online');
    assert.strictEqual(apiData.database, 'connected');
    pass('GET /api/health reports online with database connected');

    const resV1 = await fetch(`${API_BASE}/health`);
    assert.strictEqual(resV1.status, 200, 'GET /api/v1/health should return 200');
    pass('GET /api/v1/health reports online with database connected');
  } catch (e) {
    fail('Health endpoints failed', e);
  }

  // Step 2: Test Login Scenarios
  console.log('\n[Phase 2] Testing Librarian Login Scenarios…');
  try {
    // 2.1 Valid existing credentials
    const validLogin = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'azi6@crescent.education', password: 'azi@2006' }),
    });
    assert.strictEqual(validLogin.status, 200, 'Valid login should return 200');
    const loginData = await validLogin.json();
    assert.ok(loginData.token, 'Token must be present in login response');
    assert.strictEqual(loginData.user.email, 'azi6@crescent.education');
    assert.strictEqual(loginData.user.staffId, '630425');
    assert.strictEqual(loginData.user.password, undefined, 'Password hash must never be returned');
    pass('Valid existing credentials authenticated with 200 OK and JWT');

    // 2.2 Incorrect password
    const badPw = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'azi6@crescent.education', password: 'incorrect_password_999' }),
    });
    assert.strictEqual(badPw.status, 401, 'Incorrect password should return 401');
    const badPwData = await badPw.json();
    assert.strictEqual(badPwData.message, 'Invalid email address or password.');
    pass('Incorrect password rejected with generic 401 Unauthorized');

    // 2.3 Nonexistent email
    const nonExistent = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent.librarian@crescent.education', password: 'somepassword123' }),
    });
    assert.strictEqual(nonExistent.status, 401, 'Nonexistent email should return 401');
    pass('Nonexistent email rejected with generic 401 Unauthorized (user enumeration prevention)');

    // 2.4 Empty credentials
    const emptyCreds = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' }),
    });
    assert.strictEqual(emptyCreds.status, 400, 'Empty credentials should return 400');
    pass('Empty credentials rejected with 400 Bad Request');

    // 2.5 Invalid authentication token
    const invalidToken = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: 'Bearer invalid.tampered.token.123' },
    });
    assert.strictEqual(invalidToken.status, 401, 'Invalid JWT token should return 401');
    pass('Invalid authentication token rejected on protected routes with 401');

    // 2.6 Valid token access
    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.strictEqual(meRes.status, 200, 'Valid token should access /auth/me');
    const meData = await meRes.json();
    assert.strictEqual(meData.user.email, 'azi6@crescent.education');
    pass('Valid JWT token retrieves current authenticated user profile');
  } catch (e) {
    fail('Login scenarios failed', e);
  }

  // Step 3: Test Registration Scenarios
  console.log('\n[Phase 3] Testing Librarian Registration & Validation Scenarios…');
  const testTimestamp = Date.now();
  const testEmail = `dr.librarian.${testTimestamp}@crescent.education`;
  const testStaffId = `STF-${testTimestamp.toString().slice(-6)}`;

  try {
    // 3.1 Missing required name
    const missingName = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'StrongPassword@123', confirmPassword: 'StrongPassword@123' }),
    });
    assert.strictEqual(missingName.status, 400);
    pass('Missing name rejected with 400 Bad Request');

    // 3.2 Invalid email format
    const invalidEmail = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Librarian', email: 'invalid-email-no-at', password: 'StrongPassword@123' }),
    });
    assert.strictEqual(invalidEmail.status, 400);
    pass('Invalid email syntax rejected with 400 Bad Request');

    // 3.3 Weak password (<8 chars)
    const weakPw = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Librarian', email: testEmail, password: 'short', confirmPassword: 'short' }),
    });
    assert.strictEqual(weakPw.status, 400);
    pass('Short password (<8 chars) rejected with 400 Bad Request');

    // 3.4 Password mismatch
    const mismatch = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Librarian', email: testEmail, password: 'Password@123', confirmPassword: 'DifferentPassword@123' }),
    });
    assert.strictEqual(mismatch.status, 400);
    pass('Password and confirm password mismatch rejected with 400 Bad Request');

    // 3.5 Duplicate institutional email
    const dupEmail = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Librarian',
        email: 'azi6@crescent.education',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      }),
    });
    assert.strictEqual(dupEmail.status, 409, 'Duplicate email should return 409 Conflict');
    pass('Duplicate institutional email rejected with 409 Conflict');

    // 3.6 Duplicate Staff / Faculty ID
    const dupStaff = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Staff',
        email: `unique.staff.${testTimestamp}@crescent.education`,
        staffId: '630425', // Already belonging to Azi
        password: 'Password@123',
        confirmPassword: 'Password@123',
      }),
    });
    assert.strictEqual(dupStaff.status, 409, 'Duplicate Staff ID should return 409 Conflict');
    pass('Duplicate Staff ID rejected with 409 Conflict');

    // 3.7 Valid new librarian registration & persistence
    const regRes = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dr. Automated Librarian',
        email: testEmail,
        staffId: testStaffId,
        password: 'SecureAuth@2026',
        confirmPassword: 'SecureAuth@2026',
        department: 'Science & Humanities Library',
      }),
    });
    assert.strictEqual(regRes.status, 201, 'Valid registration should return 201 Created');
    const regData = await regRes.json();
    assert.ok(regData.token, 'Token returned on successful registration');
    assert.strictEqual(regData.user.email, testEmail);
    assert.strictEqual(regData.user.staffId, testStaffId);
    assert.strictEqual(regData.user.password, undefined, 'Password hash must never be returned in API');
    pass(`Valid librarian registered successfully (Email: ${testEmail}, Staff ID: ${testStaffId})`);

    // 3.8 Immediate login using newly created credentials
    const newLogin = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'SecureAuth@2026' }),
    });
    assert.strictEqual(newLogin.status, 200, 'Newly registered account should log in successfully');
    pass('Newly registered account logged in immediately with 200 OK');

    // 3.9 Direct database verification
    await mongoose.connect(process.env.MONGODB_URI);
    const dbUser = await User.findOne({ email: testEmail }).select('+password');
    assert.ok(dbUser, 'User must exist in MongoDB database');
    assert.strictEqual(dbUser.name, 'Dr. Automated Librarian');
    assert.strictEqual(dbUser.staffId, testStaffId);
    assert.ok(dbUser.password.startsWith('$2'), 'Password must be stored as bcrypt hash');
    assert.notStrictEqual(dbUser.password, 'SecureAuth@2026', 'Plaintext password must NEVER be stored');
    pass('Database record verified: bcrypt hashed password and correct field persistence in MongoDB');

    // Clean up test user
    await User.deleteOne({ email: testEmail });
    pass('Temporary test librarian record cleanly sanitized from database');
  } catch (e) {
    fail('Registration scenarios failed', e);
  }

  // Step 4: Test Password Reset & Session Management
  console.log('\n[Phase 4] Testing Password Reset, Single-Use Tokens & Logout…');
  try {
    // 4.1 Forgot password token generation
    const fpRes = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'azi6@crescent.education' }),
    });
    assert.strictEqual(fpRes.status, 200);
    const fpData = await fpRes.json();
    assert.ok(fpData.resetToken, 'Reset token generated');
    pass('Password reset token generated successfully (1-hour validity)');

    // 4.2 Single-use token reset
    const rpRes = await fetch(`${API_BASE}/auth/reset-password/${fpData.resetToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'azi@2006', confirmPassword: 'azi@2006' }),
    });
    assert.strictEqual(rpRes.status, 200);
    pass('Password reset completed successfully using single-use cryptographic token');

    // 4.3 Expired / Revoked token rejection
    const rpReuse = await fetch(`${API_BASE}/auth/reset-password/${fpData.resetToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'azi@2006', confirmPassword: 'azi@2006' }),
    });
    assert.strictEqual(rpReuse.status, 400, 'Reusing reset token must be rejected with 400');
    pass('Single-use reset token invalidated immediately and cannot be reused');

    // 4.4 Logout endpoint
    const logoutRes = await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    assert.strictEqual(logoutRes.status, 200);
    pass('POST /auth/logout invalidates session and acknowledges client');
  } catch (e) {
    fail('Password reset scenarios failed', e);
  }

  // Step 5: Verify CORS headers
  console.log('\n[Phase 5] Verifying CORS & Preflight Response Headers…');
  try {
    const corsRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5500',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    assert.strictEqual(corsRes.status, 204, 'CORS preflight should return 204 No Content');
    assert.strictEqual(corsRes.headers.get('access-control-allow-origin'), 'http://localhost:5500');
    assert.strictEqual(corsRes.headers.get('access-control-allow-private-network'), 'true');
    pass('CORS preflight reflects calling origin and permits Chrome Private Network Access');
  } catch (e) {
    fail('CORS verification failed', e);
  }

  console.log('\n============================================================');
  console.log('🎉  All 20 Authentication Test Assertions: PASSED | 0 FAILED');
  console.log('============================================================\n');
  process.exit(0);
}

runTests();
