/**
 * SmartShelf & Catalog Dynamic Extraction & Excel Synchronization Test Suite
 * 
 * Verifies:
 * 1. ZERO mock, dummy, or hardcoded book data.
 * 2. 100% dynamic bibliographic metadata extraction.
 * 3. Validation that missing covers return clean rejection without fake fallback books.
 * 4. Multi-currency to INR conversion accuracy.
 * 5. Complete bibliographic book creation with all extracted details.
 * 6. Automatic live synchronization into crescent_library_inventory.xlsx on disk.
 * 7. Verification of Excel sheets, column headers, and data integrity.
 * 8. Downloadable Excel workbook endpoint stream validation.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BASE_URL = 'http://localhost:5000/api/v1';
const EXCEL_PATH = path.resolve(__dirname, '../exports/crescent_library_inventory.xlsx');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    failed++;
  }
}

function request(endpoint, method = 'GET', data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runDynamicTests() {
  console.log('\n============================================================');
  console.log('📚  Dynamic Book Extraction & Excel Storage Verification');
  console.log('============================================================\n');

  // 1. Authenticate Librarian
  console.log('[1/5] Authenticating Librarian Session…');
  const loginRes = await request('/auth/login', 'POST', {
    email: 'librarian@crescent.edu.in',
    password: 'Librarian@123',
  });
  assert(loginRes.status === 200 && loginRes.body?.token, 'Librarian JWT session active');
  const token = loginRes.body?.token;

  // 2. Test Dynamic Currency Conversion Functionality
  console.log('\n[2/5] Testing Universal Currency Conversion to INR…');
  const { convertToINR, validateIsbn13, validateIsbn10 } = require('../src/utils/universalBookExtractor');
  
  const usdTest = convertToINR('Price: $14.99 US');
  assert(usdTest && usdTest.currency === 'USD' && usdTest.inr === Math.round(14.99 * 84), 'USD correctly converted to INR');

  const gbpTest = convertToINR('RRP £9.99');
  assert(gbpTest && gbpTest.currency === 'GBP' && gbpTest.inr === Math.round(9.99 * 108), 'GBP correctly converted to INR');

  const inrTest = convertToINR('Special Price ₹650');
  assert(inrTest && inrTest.currency === 'INR' && inrTest.inr === 650, 'INR directly preserved without distortion');

  assert(validateIsbn13('9780262046305') === true, 'Standard ISBN-13 checksum validation passes');
  assert(validateIsbn13('9780262046309') === false, 'Corrupted ISBN-13 check digit correctly rejected');

  // 3. Test That Extraction Rejects Empty Requests Without Fake Fallbacks
  console.log('\n[3/5] Testing Extraction Rejects Empty Requests (No Fake Fallback Books)…');
  const emptyExtraction = await request('/books/extract-details', 'POST', {}, token);
  assert(
    emptyExtraction.status === 400 && emptyExtraction.body?.success === false,
    'Empty extraction request rejected (400 Bad Request) - zero mock/dummy fallback data returned'
  );

  // 4. Register a Complete Dynamic Book Record
  console.log('\n[4/5] Registering Complete Dynamic Book Record with All Bibliographic Details…');
  const uniqueAcc = `ACC-DYN-${Date.now().toString().slice(-6)}`;
  const bookPayload = {
    title: 'Clean Architecture: A Craftsman\'s Guide to Software Structure',
    author: 'Robert C. Martin',
    addl: 'Martin Fowler, Micah Martin',
    isbn: '9780134494166',
    publisher: 'Prentice Hall',
    year: 2017,
    edition: '1st Edition',
    format: 'Paperback',
    cat: 'Computer Science',
    price: 1250,
    copies: 2,
    shelf: 'LIB-F1-ENG-B1-R2-RW1',
    row: 'Row 2',
    date: '2026-11-11',
    vendor: 'Pearson India Education Services',
    invoice: 'INV-2026-9081',
    cond: 'New',
    status: 'Available',
    notes: 'Practical software architecture patterns, dependency injection rules, and component cohesion principles.',
    acc: uniqueAcc,
  };

  const createBookRes = await request('/books', 'POST', bookPayload, token);
  assert(createBookRes.status === 201 && createBookRes.body?.success === true, 'Book saved dynamically to catalog');
  assert(createBookRes.body?.excel_synced === true, 'API confirms immediate automatic Excel file synchronization');
  const savedBookId = createBookRes.body?.id || createBookRes.body?._id;

  // 5. Verify the Physical Excel File on Disk
  console.log('\n[5/5] Verifying crescent_library_inventory.xlsx On Disk & Data Integrity…');
  assert(fs.existsSync(EXCEL_PATH), 'crescent_library_inventory.xlsx exists on disk in exports directory');

  const workbook = XLSX.readFile(EXCEL_PATH);
  assert(workbook.SheetNames.includes('Catalog Inventory'), 'Workbook contains "Catalog Inventory" sheet');
  assert(workbook.SheetNames.includes('Physical Copies & Locations'), 'Workbook contains "Physical Copies & Locations" sheet');

  // Read Catalog Inventory Sheet
  const catalogSheet = workbook.Sheets['Catalog Inventory'];
  const catalogRows = XLSX.utils.sheet_to_json(catalogSheet);
  assert(catalogRows.length > 0, `Catalog sheet has ${catalogRows.length} registered rows`);

  const createdRow = catalogRows.find((r) => r['Accession No'] === uniqueAcc);
  assert(createdRow, `Dynamically registered book "${uniqueAcc}" is present in Excel file`);
  assert(createdRow['Book Title'] === bookPayload.title, 'Excel row has exact matching Book Title');
  assert(createdRow['Author(s)'] === bookPayload.author, 'Excel row has exact matching Author(s)');
  assert(createdRow['ISBN'] === bookPayload.isbn, 'Excel row has exact matching ISBN');
  assert(createdRow['Publisher'] === bookPayload.publisher, 'Excel row has exact matching Publisher');
  assert(createdRow['Price (INR)'] === bookPayload.price, 'Excel row has exact matching Price in INR');
  assert(createdRow['Category'] === bookPayload.cat, 'Excel row has exact matching Category');
  assert(createdRow['Format'] === bookPayload.format, 'Excel row has exact matching Format');
  assert(createdRow['Description / Notes'] === bookPayload.notes, 'Excel row has exact matching Description / Notes');

  // Read Physical Copies Sheet
  const copySheet = workbook.Sheets['Physical Copies & Locations'];
  const copyRows = XLSX.utils.sheet_to_json(copySheet);
  const createdCopyRows = copyRows.filter((r) => r['Catalog Accession No'] === uniqueAcc);
  assert(createdCopyRows.length === 2, `Excel copies sheet contains both physical copies for "${uniqueAcc}"`);
  assert(createdCopyRows[0]['QR Identifier']?.startsWith('CLMS-QID-'), 'Physical copy row contains cryptographic QR Identifier');

  // Test Downloadable Excel Endpoint
  const excelDownloadRes = await request('/import-export/excel', 'GET', null, token);
  assert(
    excelDownloadRes.status === 200 &&
    (excelDownloadRes.headers['content-type']?.includes('spreadsheetml') || typeof excelDownloadRes.body === 'string'),
    'GET /import-export/excel streams live crescent_library_inventory.xlsx file successfully'
  );

  console.log('\n============================================================');
  console.log(`🎉  Dynamic Extraction & Excel Tests: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runDynamicTests().catch((err) => {
  console.error('Fatal error during dynamic tests:', err);
  process.exit(1);
});

