'use strict';
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {}

const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const mongoose = require('mongoose');

const PORT = process.env.PORT || 5000;
const HOST = 'localhost';

const request = (endpoint, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: `/api/v1${endpoint}`,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

async function runIsolationVerification() {
  console.log('============================================================');
  console.log('🛡️  Verifying Multi-Tenant User Data Isolation & No Overlap');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, name, detail = '') => {
    if (condition) {
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${name} (${detail})`);
    }
  };

  const ts = Date.now();
  const userA = {
    name: 'Dr. Librarian Alpha',
    email: `alpha.${ts}@crescent.education`,
    staffId: `STAFF-A-${ts.toString().slice(-5)}`,
    password: 'AlphaPassword@2026!',
    confirmPassword: 'AlphaPassword@2026!',
  };

  const userB = {
    name: 'Dr. Librarian Beta',
    email: `beta.${ts}@crescent.education`,
    staffId: `STAFF-B-${ts.toString().slice(-5)}`,
    password: 'BetaPassword@2026!',
    confirmPassword: 'BetaPassword@2026!',
  };

  try {
    // 1. Register User A and User B
    console.log('[1/6] Registering User Alpha and User Beta…');
    const regA = await request('/auth/register', 'POST', userA);
    assert(regA.status === 201 && regA.body?.token, 'User Alpha registered successfully with JWT');
    const tokenA = regA.body?.token;

    const regB = await request('/auth/register', 'POST', userB);
    assert(regB.status === 201 && regB.body?.token, 'User Beta registered successfully with JWT');
    const tokenB = regB.body?.token;

    // 2. User A creates Book A
    console.log('\n[2/6] User Alpha creates Book Alpha in MongoDB…');
    const bookPayloadA = {
      title: `Quantum Algorithms by Alpha ${ts}`,
      acc: `ACC-ALPHA-${ts.toString().slice(-5)}`,
      isbn: '9780134685991',
      author: 'Dr. Alpha Scientist',
      publisher: 'Alpha Science Press',
      price: 1500,
      copies: 2,
      cat: 'Computer Science',
      status: 'Available',
    };
    const createResA = await request('/books', 'POST', bookPayloadA, tokenA);
    assert(createResA.status === 201 && createResA.body?.id, 'Book Alpha created by User Alpha');
    const bookIdA = createResA.body?.id;

    // 3. User B creates Book B
    console.log('\n[3/6] User Beta creates Book Beta in MongoDB…');
    const bookPayloadB = {
      title: `Astrophysics Fundamentals by Beta ${ts}`,
      acc: `ACC-BETA-${ts.toString().slice(-5)}`,
      isbn: '9780134685992',
      author: 'Dr. Beta Cosmologist',
      publisher: 'Beta University Press',
      price: 2400,
      copies: 3,
      cat: 'Physics',
      status: 'Available',
    };
    const createResB = await request('/books', 'POST', bookPayloadB, tokenB);
    assert(createResB.status === 201 && createResB.body?.id, 'Book Beta created by User Beta');
    const bookIdB = createResB.body?.id;

    // 4. Verify Zero Overlap: User A sees only Book A, User B sees only Book B
    console.log('\n[4/6] Verifying Strict Inventory Isolation (No Overlap)…');
    const listA = await request('/books', 'GET', null, tokenA);
    const booksA = listA.body?.items || [];
    assert(
      booksA.some((b) => b.title === bookPayloadA.title) &&
      !booksA.some((b) => b.title === bookPayloadB.title),
      'User Alpha catalog contains Book Alpha and ZERO titles from User Beta'
    );

    const listB = await request('/books', 'GET', null, tokenB);
    const booksB = listB.body?.items || [];
    assert(
      booksB.some((b) => b.title === bookPayloadB.title) &&
      !booksB.some((b) => b.title === bookPayloadA.title),
      'User Beta catalog contains Book Beta and ZERO titles from User Alpha'
    );

    // 5. Verify Reports and Summary Isolation
    console.log('\n[5/6] Verifying User-Scoped Reports and Summaries…');
    const repA = await request('/reports/summary', 'GET', null, tokenA);
    assert(
      repA.body?.totalBooks === 1 && repA.body?.totalCopies === 2 && repA.body?.totalValue === 3000,
      'User Alpha reports reflect exactly Alpha personal inventory (1 title, 2 copies, ₹3000 valuation)'
    );

    const repB = await request('/reports/summary', 'GET', null, tokenB);
    assert(
      repB.body?.totalBooks === 1 && repB.body?.totalCopies === 3 && repB.body?.totalValue === 7200,
      'User Beta reports reflect exactly Beta personal inventory (1 title, 3 copies, ₹7200 valuation)'
    );

    // 6. Verify Ownership Mutation Block (Security: Alpha cannot modify or delete Beta's book)
    console.log('\n[6/6] Verifying Cross-User Mutation Prevention (403 Forbidden)…');
    const hackUpdate = await request(`/books/${bookIdB}`, 'PATCH', { title: 'Compromised Title' }, tokenA);
    assert(hackUpdate.status === 403, 'User Alpha is strictly FORBIDDEN (403) from editing User Beta book');

    const hackDelete = await request(`/books/${bookIdB}`, 'DELETE', null, tokenA);
    assert(hackDelete.status === 403, 'User Alpha is strictly FORBIDDEN (403) from deleting User Beta book');

    // Clean up temporary isolation test records
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('./src/models/User');
    const Book = require('./src/models/Book');
    const BookCopy = require('./src/models/BookCopy');
    await User.deleteMany({ email: { $in: [userA.email, userB.email] } });
    await Book.deleteMany({ _id: { $in: [bookIdA, bookIdB] } });
    await BookCopy.deleteMany({ bookId: { $in: [bookIdA, bookIdB] } });
    await mongoose.disconnect();

    console.log('\n============================================================');
    console.log(`🎉  Isolation Verification: ${passed} PASSED | ${failed} FAILED`);
    console.log('============================================================');
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runIsolationVerification();

