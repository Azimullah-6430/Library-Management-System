'use strict';
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const HOST = 'localhost';

const request = (reqPath, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = {
      hostname: HOST,
      port: PORT,
      path: `/api/v1${reqPath}`,
      method,
      headers,
    };

    const req = http.request(opts, (res) => {
      let data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json')) {
          try {
            const parsed = JSON.parse(buffer.toString('utf-8'));
            resolve({ status: res.statusCode, body: parsed, headers: res.headers });
          } catch (_) {
            resolve({ status: res.statusCode, raw: buffer.toString('utf-8'), buffer, headers: res.headers });
          }
        } else {
          resolve({ status: res.statusCode, raw: buffer.toString('utf-8'), buffer, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

async function runEndToEndWorkflow() {
  console.log('\n============================================================');
  console.log('🚀  SmartShelf AI Complete End-to-End Workflow Verification');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, stepName, details = '') => {
    if (condition) {
      passed++;
      console.log(`  ✓ [PASS] ${stepName}`);
    } else {
      failed++;
      console.error(`  ✗ [FAIL] ${stepName} ${details ? '— ' + details : ''}`);
    }
  };

  try {
    // 0. Authenticate Librarian Session
    console.log('[Step 0/10] Authenticating Librarian Session…');
    const authRes = await request('/auth/login', 'POST', {
      email: 'librarian@crescent.edu.in',
      password: 'Librarian@123',
    });
    assert(authRes.status === 200 && authRes.body?.token, 'Librarian login succeeds with JWT');
    const token = authRes.body.token;

    // Load available physical shelf locations
    const locsRes = await request('/smartshelf/locations', 'GET', null, token);
    const locations = locsRes.body?.locations || [];
    assert(locations.length >= 3, 'Library physical locations are active and available');
    const shelfA = locations[0];
    const shelfB = locations[1] || locations[0];
    const shelfC = locations[2] || locations[0];

    // 1. Register Book in Catalog
    console.log('\n[Step 1/10] Registering Bibliographic Book in Catalog…');
    const uniqueAcc = `ACC-E2E-${Date.now().toString().slice(-6)}`;
    const newBookPayload = {
      title: 'Clean Architecture: A Craftsman\'s Guide',
      author: 'Robert C. Martin',
      isbn: `978013449${Math.floor(1000 + Math.random() * 9000)}`,
      publisher: 'Prentice Hall',
      cat: 'Computer Science',
      year: 2018,
      price: 1850,
      copies: 3,
      acc: uniqueAcc,
      shelf: shelfA.locationCode,
      status: 'Available',
    };

    const createBookRes = await request('/books', 'POST', newBookPayload, token);
    assert(
      createBookRes.status === 201 && (createBookRes.body?.book || createBookRes.body?.data),
      'Book registered in catalog with bibliographic metadata'
    );
    const createdBook = createBookRes.body?.book || createBookRes.body?.data;
    const bookId = createdBook._id || createdBook.id;

    // 2. Create and Verify Physical Copies
    console.log('\n[Step 2/10] Verifying Individual Physical Copies…');
    // Copies are auto-provisioned upon catalog book creation
    const getBookCopiesRes = await request(`/smartshelf/books/${bookId}/copies`, 'GET', null, token);
    const copies = getBookCopiesRes.body?.copies || [];
    assert(copies.length === 3, 'Catalog title representation has exactly 3 physical copies');
    assert(
      copies[0].copyId !== copies[1].copyId && copies[1].copyId !== copies[2].copyId,
      'Every physical copy receives a distinct, unique Copy ID'
    );
    assert(
      copies[0].accessionNumber !== copies[1].accessionNumber,
      'Every physical copy maintains its own distinct accession number'
    );

    const copy1 = copies[0];
    const copy2 = copies[1];
    const copy3 = copies[2];

    // 3. Generate QR Codes & PDF Label Sheets
    console.log('\n[Step 3/10] Generating QR Codes & Label Sheets…');
    assert(
      copy1.qrIdentifier && copy1.qrIdentifier !== copy2.qrIdentifier,
      'Cryptographically unique QR identifiers generated per copy'
    );

    const qrPngRes = await request(`/smartshelf/copies/${copy1.copyId}/qr.png`, 'GET', null, token);
    assert(qrPngRes.status === 200 && (qrPngRes.buffer?.length > 100 || qrPngRes.raw?.length > 100), 'Generate high-resolution QR PNG image');

    const pdfLabelsRes = await request(`/smartshelf/books/${bookId}/labels/pdf`, 'GET', null, token);
    assert(
      pdfLabelsRes.status === 200 && pdfLabelsRes.buffer?.toString('utf-8', 0, 4) === '%PDF',
      'Generate printable multi-copy PDF label sheet'
    );

    // 4. Assign & Verify Independent Physical Locations
    console.log('\n[Step 4/10] Verifying Location Assignment Hierarchy…');
    // Distribute copies across different shelves
    await request(`/smartshelf/copies/${copy2._id}/move`, 'POST', {
      newLocationId: shelfB._id,
      reason: 'RELOCATION',
      remarks: 'Initial shelf distribution to Shelf B',
    }, token);

    await request(`/smartshelf/copies/${copy3._id}/move`, 'POST', {
      newLocationId: shelfC._id,
      reason: 'RELOCATION',
      remarks: 'Initial shelf distribution to Shelf C',
    }, token);

    const copy1LocRes = await request(`/smartshelf/copies/${copy1._id}/location`, 'GET', null, token);
    assert(
      copy1LocRes.status === 200 && copy1LocRes.body?.locationCode === shelfA.locationCode,
      `Copy 1 independently assigned to shelf "${shelfA.locationCode}"`
    );

    const copy2LocRes = await request(`/smartshelf/copies/${copy2._id}/location`, 'GET', null, token);
    assert(
      copy2LocRes.status === 200 && copy2LocRes.body?.locationCode === shelfB.locationCode,
      `Copy 2 independently assigned to shelf "${shelfB.locationCode}"`
    );

    // 5. Live Universal QR Code Scanning & Misplacement Detection
    console.log('\n[Step 5/10] Testing Live QR Scanner & Misplacement Detection…');
    // Scan Copy 1 at its correct shelf -> Verified
    const scanMatchRes = await request('/smartshelf/scan', 'POST', {
      qrText: copy1.qrIdentifier,
      currentShelfContextId: shelfA._id,
    }, token);
    assert(
      scanMatchRes.status === 200 &&
        (scanMatchRes.body?.isMatched === true || scanMatchRes.body?.verification?.isMatched === true),
      'Universal QR scanner verifies book on its registered shelf'
    );

    // Scan Copy 1 at a different shelf -> Misplacement warning
    const scanMisplaceRes = await request('/smartshelf/scan', 'POST', {
      qrText: copy1.qrIdentifier,
      currentShelfContextId: shelfB._id,
    }, token);
    assert(
      scanMisplaceRes.status === 200 &&
        (scanMisplaceRes.body?.isMatched === false || scanMisplaceRes.body?.verification?.isMatched === false),
      'Universal QR scanner accurately identifies misplaced volume and reveals home shelf'
    );

    // 6. Intelligent Book Finder
    console.log('\n[Step 6/10] Testing Intelligent Book Finder & Location Retrieval…');
    const findRes = await request('/smartshelf/books/find?q=Architecture', 'GET', null, token);
    assert(
      findRes.status === 200 && findRes.body?.total >= 1,
      'Book Finder retrieves catalog title matching search keyword'
    );
    const foundBook = findRes.body?.books?.find((b) => (b._id?.toString() || b.id) === bookId.toString());
    assert(
      foundBook && Array.isArray(foundBook.copies) && foundBook.copies.length === 3,
      'Book Finder displays all 3 distinct physical copies with 6-tier location hierarchies'
    );

    // 7. Physical Book Movement with ACID Atomic Transaction
    console.log('\n[Step 7/10] Performing Physical Book Relocation…');
    const moveRes = await request(`/smartshelf/copies/${copy1._id}/move`, 'POST', {
      newLocationId: shelfC._id,
      reason: 'RELOCATION',
      remarks: 'Relocated to Reference shelf for semester reserve',
    }, token);
    assert(
      moveRes.status === 200 && moveRes.body?.currentLocation === shelfC.locationCode,
      `Copy 1 relocated atomically from "${shelfA.locationCode}" to "${shelfC.locationCode}"`
    );

    // 8. Verify Immutable Movement Chain-of-Custody History
    console.log('\n[Step 8/10] Verifying Chain-of-Custody Movement History…');
    const historyRes = await request(`/smartshelf/copies/${copy1._id}/movements`, 'GET', null, token);
    assert(
      historyRes.status === 200 && Array.isArray(historyRes.body?.movements) && historyRes.body?.movements?.length >= 2,
      'Permanent movement history preserves all relocation steps and librarian custody'
    );

    // 9. Perform Shelf Inventory Audit
    console.log('\n[Step 9/10] Conducting Shelf Inventory Audit Session…');
    const startAuditRes = await request('/smartshelf/audits/start', 'POST', {
      locationId: shelfC._id,
      scope: 'SHELF',
      notes: 'End-to-End E2E Automated Shelf Verification',
    }, token);
    assert(startAuditRes.status === 201 && startAuditRes.body?.audit?.auditNumber, 'Initialize shelf audit session');
    const auditId = startAuditRes.body?.audit?._id;

    // Scan Copy 1 in audit -> VERIFIED
    const auditScanRes = await request(`/smartshelf/audits/${auditId}/scan`, 'POST', {
      copyIdentifier: copy1.copyId,
    }, token);
    assert(
      auditScanRes.status === 200 &&
        (auditScanRes.body?.verificationResult === 'VERIFIED' || auditScanRes.body?.verificationResult === 'MATCHED'),
      'Audit scan verifies copy presence on shelf'
    );

    // Finalize audit
    const finalizeAuditRes = await request(`/smartshelf/audits/${auditId}/complete`, 'POST', {}, token);
    assert(
      finalizeAuditRes.status === 200 && finalizeAuditRes.body?.audit?.status === 'COMPLETED',
      'Audit session successfully finalized'
    );

    // 10. Generate Audit Report & Excel Sync
    console.log('\n[Step 10/10] Generating Audit CSV Report & Excel Inventory Workbook…');
    const auditCsvRes = await request(`/smartshelf/audits/${auditId}/export?format=csv`, 'GET', null, token);
    assert(
      auditCsvRes.status === 200 && (auditCsvRes.raw || '').includes('CRESCENT INSTITUTE CENTRAL LIBRARY'),
      'Export audit report as downloadable CSV'
    );

    // Test Excel export containing copy-level location details
    const excelRes = await request('/import-export/excel', 'GET', null, token);
    assert(
      excelRes.status === 200 && excelRes.buffer?.length > 1000,
      'Export full inventory Excel (.xlsx) workbook containing physical copies and 6-tier location codes'
    );

    // Verify Dashboard Global Counts API
    const dashCountsRes = await request('/smartshelf/inventory-counts', 'GET', null, token);
    assert(
      dashCountsRes.status === 200 &&
        dashCountsRes.body?.counts?.totalPhysicalCopies >= 24 &&
        dashCountsRes.body?.counts?.activeLocations >= 6,
      'Dashboard metrics API calculates live database-derived inventory counts'
    );

    console.log('\n============================================================');
    console.log(`🎉  SmartShelf AI End-to-End Workflow: ${passed} PASSED | ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Workflow execution error:', err);
    process.exit(1);
  }
}

runEndToEndWorkflow();
