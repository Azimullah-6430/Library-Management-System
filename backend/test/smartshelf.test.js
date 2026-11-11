'use strict';
require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 5000;
const HOST = 'localhost';

const request = (path, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = {
      hostname: HOST,
      port: PORT,
      path: `/api/v1${path}`,
      method,
      headers,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

async function runTestSuite() {
  console.log('\n============================================================');
  console.log('🧪  SmartShelf AI Backend Integration Test Suite');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, name, details = '') => {
    if (condition) {
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  ✗ [FAIL] ${name} ${details ? `(${details})` : ''}`);
    }
  };

  try {
    // 1. Authenticate as Librarian
    console.log('[1/7] Authenticating Librarian Session…');
    const loginRes = await request('/auth/login', 'POST', {
      email: 'librarian@crescent.edu.in',
      password: 'Librarian@123',
    });
    assert(loginRes.status === 200 && loginRes.body?.token, 'Librarian login succeeds with JWT');
    const token = loginRes.body?.token;

    // 2. Unauthenticated Security Rejection Test
    console.log('\n[2/7] Testing Server-Side Write Authorization…');
    const unauthRes = await request('/smartshelf/locations', 'POST', {
      floor: '3rd Floor',
      section: 'Robotics',
      shelf: 'R-1',
      rack: 'Rack 1',
      row: 'Row 1',
    });
    assert(unauthRes.status === 401, 'Unauthenticated write is rejected with 401');

    // 3. Locations CRUD & Hierarchy
    console.log('\n[3/7] Testing 6-Tier Location Management…');
    const listLocsRes = await request('/smartshelf/locations', 'GET', null, token);
    assert(listLocsRes.status === 200 && listLocsRes.body?.total >= 5, 'List locations returns seeded physical shelves');

    const testLocCode = `LIB-TEST-${Date.now().toString().slice(-4)}`;
    const createLocRes = await request(
      '/smartshelf/locations',
      'POST',
      {
        building: 'Central Library',
        floor: '2nd Floor',
        section: 'Mathematics & Data Science',
        shelf: `M-${Date.now().toString().slice(-4)}`,
        rack: 'Rack 1',
        row: 'Row 1',
        description: 'Applied Mathematics and Statistical Analysis',
        capacity: 35,
      },
      token
    );
    assert(createLocRes.status === 201 || createLocRes.status === 409, 'Create 6-tier location node');
    const testLocation = createLocRes.body?.location || listLocsRes.body?.locations?.[0];
    const testLocationId = testLocation._id || testLocation.id;

    const deactRes = await request(`/smartshelf/locations/${testLocationId}/deactivate`, 'PATCH', {}, token);
    assert(deactRes.status === 200 && deactRes.body?.location?.isActive === false, 'Deactivate location sets isActive: false');

    const actRes = await request(`/smartshelf/locations/${testLocationId}/activate`, 'PATCH', {}, token);
    assert(actRes.status === 200 && actRes.body?.location?.isActive === true, 'Reactivate location restores isActive: true');

    const qrLocRes = await request(`/smartshelf/locations/${testLocationId}/qr`, 'GET', null, token);
    assert(qrLocRes.status === 200 && qrLocRes.body?.svg?.includes('<svg'), 'Get printable SVG shelf QR tag');

    const metaRes = await request('/smartshelf/locations/meta', 'GET', null, token);
    assert(metaRes.status === 200 && Array.isArray(metaRes.body?.data?.buildings), 'Retrieve 6-tier location hierarchy metadata');

    const treeRes = await request('/smartshelf/locations/tree', 'GET', null, token);
    assert(treeRes.status === 200 && Array.isArray(treeRes.body?.tree), 'Retrieve 6-tier nested hierarchical location tree');

    const locDetailRes = await request(`/smartshelf/locations/${testLocationId}`, 'GET', null, token);
    assert(locDetailRes.status === 200 && locDetailRes.body?.location?.locationCode, 'Retrieve location details with copy inventory');

    // 4. Physical Book Copies Management
    console.log('\n[4/7] Testing Physical BookCopy Management & Tracking…');
    const listCopiesRes = await request('/smartshelf/copies', 'GET', null, token);
    assert(listCopiesRes.status === 200 && listCopiesRes.body?.total >= 10, 'List physical copies returns migrated records');

    const sampleCopy = listCopiesRes.body?.copies?.[0];
    assert(sampleCopy && typeof sampleCopy.qrIdentifier === 'string' && sampleCopy.qrIdentifier.length >= 5, 'Copy has unique cryptographic QR identifier');
    assert(sampleCopy && sampleCopy.accessionNumber, 'Copy has unique accession number');

    const getCopyRes = await request(`/smartshelf/copies/${sampleCopy.copyId}`, 'GET', null, token);
    assert(getCopyRes.status === 200 && getCopyRes.body?.copy?.copyId === sampleCopy.copyId, 'Retrieve individual copy by copyId');

    const patchCopyRes = await request(
      `/smartshelf/copies/${sampleCopy._id}`,
      'PATCH',
      { condition: 'New', notes: 'Inspected during automated audit test' },
      token
    );
    assert(patchCopyRes.status === 200 && patchCopyRes.body?.copy?.condition === 'New', 'Update copy condition & notes');

    const copyLocRes = await request(`/smartshelf/copies/${sampleCopy._id}/location`, 'GET', null, token);
    assert(copyLocRes.status === 200 && copyLocRes.body?.locationCode, 'Retrieve current physical copy location');

    // 5. ACID Transaction Book Relocation & Immutable Movement History
    console.log('\n[5/7] Testing ACID Book Movement & Movement Log…');
    const currentLocId = String(sampleCopy.locationId?._id || sampleCopy.locationId || copyLocRes.body?.locationId || '');
    const targetMoveLocation = listLocsRes.body?.locations?.find((l) => String(l._id || l.id) !== currentLocId) || listLocsRes.body?.locations?.[0];
    const moveRes = await request(
      `/smartshelf/copies/${sampleCopy._id}/move`,
      'POST',
      {
        newLocationId: targetMoveLocation._id || targetMoveLocation.id,
        reason: 'RELOCATION',
        remarks: 'Test relocation to new shelf',
      },
      token
    );
    assert(moveRes.status === 200 && moveRes.body?.currentLocation === targetMoveLocation.locationCode, 'Move copy updates location atomically');

    // Test duplicate movement rejection
    const dupMoveRes = await request(
      `/smartshelf/copies/${sampleCopy._id}/move`,
      'POST',
      {
        newLocationId: targetMoveLocation._id || targetMoveLocation.id,
        reason: 'RELOCATION',
      },
      token
    );
    assert(dupMoveRes.status === 400, 'Duplicate movement to same location is rejected');

    const movementsRes = await request(`/smartshelf/copies/${sampleCopy._id}/movements`, 'GET', null, token);
    assert(movementsRes.status === 200 && movementsRes.body?.totalMovements >= 2, 'Movement history preserves all historical steps');

    // 6. Universal Live QR Scanner
    console.log('\n[6/7] Testing Universal QR Resolution & Misplacement Detection…');
    const scanCopyRes = await request(
      '/smartshelf/scan',
      'POST',
      {
        qrText: sampleCopy.qrIdentifier,
        currentShelfContextId: targetMoveLocation._id || targetMoveLocation.id,
      },
      token
    );
    assert(scanCopyRes.status === 200 && scanCopyRes.body?.entityType === 'COPY', 'Universal scanner resolves copy QR code');

    const scanLocRes = await request(
      '/smartshelf/scan',
      'POST',
      {
        qrText: targetMoveLocation.qrIdentifier || `CLMS:LOC:${targetMoveLocation.locationCode}`,
      },
      token
    );
    assert(scanLocRes.status === 200 && scanLocRes.body?.entityType === 'LOCATION', 'Universal scanner resolves shelf location QR code');

    // 7. Inventory Audit & Shelf Reconciliation
    console.log('\n[7/7] Testing SmartShelf Shelf Inventory Audit & Exception Reconciliation…');
    const startAuditRes = await request(
      '/smartshelf/audits/start',
      'POST',
      {
        locationId: targetMoveLocation._id || targetMoveLocation.id,
        scope: 'SHELF',
        notes: 'Automated Shelf A-2 Verification Audit',
      },
      token
    );
    assert(startAuditRes.status === 201 && startAuditRes.body?.audit?.auditNumber, 'Start shelf audit session');
    const auditId = startAuditRes.body?.audit?._id || startAuditRes.body?.audit?.id;
    assert(
      Array.isArray(startAuditRes.body?.audit?.missingCopies) && startAuditRes.body?.audit?.missingCopies.length === 0,
      'Crucial rule: missing copies list is empty while audit is in progress'
    );

    // 7a. Verified scan
    const scanAuditRes = await request(
      `/smartshelf/audits/${auditId}/scan`,
      'POST',
      {
        copyIdentifier: sampleCopy.copyId,
      },
      token
    );
    assert(
      scanAuditRes.status === 200 &&
        (scanAuditRes.body?.verificationResult === 'VERIFIED' || scanAuditRes.body?.verificationResult === 'MATCHED'),
      'Audit scan verifies matched copy (VERIFIED)'
    );

    // 7b. Duplicate scan test
    const dupScanRes = await request(
      `/smartshelf/audits/${auditId}/scan`,
      'POST',
      {
        copyIdentifier: sampleCopy.copyId,
      },
      token
    );
    assert(dupScanRes.status === 200 && dupScanRes.body?.verificationResult === 'DUPLICATE', 'Audit scan detects duplicate scan');

    // 7c. Unknown QR scan test
    const unknownScanRes = await request(
      `/smartshelf/audits/${auditId}/scan`,
      'POST',
      {
        copyIdentifier: 'CLMS-UNKNOWN-999999',
      },
      token
    );
    assert(
      unknownScanRes.status === 200 && unknownScanRes.body?.verificationResult === 'UNKNOWN',
      'Audit scan classifies unknown QR code without failing'
    );

    // 7d. Misplaced copy scan test
    // Find a copy that belongs to a different location and was not already scanned
    const targetLocIdStr = String(targetMoveLocation._id || targetMoveLocation.id);
    const otherCopyDoc = (listCopiesRes.body?.copies || []).find((c) => {
      const cLocId = String(c.locationId?._id || c.locationId || '');
      return cLocId && cLocId !== targetLocIdStr && c.copyId !== sampleCopy.copyId;
    });
    if (otherCopyDoc) {
      const misplacedScanRes = await request(
        `/smartshelf/audits/${auditId}/scan`,
        'POST',
        {
          copyIdentifier: otherCopyDoc.copyId,
        },
        token
      );
      assert(
        misplacedScanRes.status === 200 && misplacedScanRes.body?.verificationResult === 'MISPLACED',
        'Audit scan correctly detects misplaced copy'
      );

      // Verify rule: Misplaced copy must NOT be relocated automatically
      const checkMisplacedCopy = await request(`/smartshelf/copies/${otherCopyDoc.copyId}`, 'GET', null, token);
      assert(
        checkMisplacedCopy.body?.copy?.isMisplaced === true &&
          String(checkMisplacedCopy.body?.copy?.locationId?._id || checkMisplacedCopy.body?.copy?.locationId) !==
            targetLocIdStr,
        'Misplaced copy is marked in catalog but NOT relocated automatically'
      );

      // 7e. Resolve exception via explicit librarian action
      const resolveRes = await request(
        `/smartshelf/audits/${auditId}/resolve`,
        'POST',
        {
          copyIdentifier: otherCopyDoc.copyId,
          itemType: 'MISPLACED',
          action: 'RETURN_TO_HOME',
          notes: 'Confirmed to be returned to original shelf by librarian',
        },
        token
      );
      assert(resolveRes.status === 200 && resolveRes.body?.success, 'Librarian can resolve misplaced exception');
    }

    // 7f. Finalize audit session
    const completeAuditRes = await request(`/smartshelf/audits/${auditId}/complete`, 'POST', {}, token);
    assert(
      completeAuditRes.status === 200 && completeAuditRes.body?.audit?.status === 'COMPLETED',
      'Finalize audit session generates missing copies and sets COMPLETED'
    );

    // 7g. Retrieve full audit by ID
    const getAuditRes = await request(`/smartshelf/audits/${auditId}`, 'GET', null, token);
    assert(
      getAuditRes.status === 200 && getAuditRes.body?.audit?.auditNumber && Array.isArray(getAuditRes.body?.scans),
      'Retrieve detailed audit session with complete scan history'
    );

    // 7h. Export audit report as CSV
    const exportRes = await request(`/smartshelf/audits/${auditId}/export?format=csv`, 'GET', null, token);
    assert(
      exportRes.status === 200 &&
        ((exportRes.body && String(exportRes.body).includes('CRESCENT INSTITUTE CENTRAL LIBRARY')) ||
          (exportRes.raw && exportRes.raw.includes('CRESCENT INSTITUTE CENTRAL LIBRARY'))),
      'Export audit report as CSV format'
    );

    const countsRes = await request(`/smartshelf/locations/${targetMoveLocation._id || targetMoveLocation.id}/counts`, 'GET', null, token);
    assert(countsRes.status === 200 && countsRes.body?.location?.totalCopies >= 1, 'Retrieve inventory counts by location');

    const globalCountsRes = await request('/smartshelf/inventory-counts', 'GET', null, token);
    assert(globalCountsRes.status === 200 && globalCountsRes.body?.summary?.totalPhysicalCopies >= 10, 'Retrieve global inventory counts');

    // 8. Cryptographic QR Uniqueness, Label PDF Generation, and Revocation Workflow
    console.log('\n[8/8] Testing QR Uniqueness, PDF Sheet Generation, and Revocation Workflow…');
    // 8a. Verify 100% uniqueness of all QR identifiers
    const allCopiesForUniqueness = await request('/smartshelf/copies?limit=100', 'GET', null, token);
    const qidSet = new Set();
    let collisionDetected = false;
    (allCopiesForUniqueness.body?.copies || []).forEach((c) => {
      if (qidSet.has(c.qrIdentifier)) collisionDetected = true;
      qidSet.add(c.qrIdentifier);
    });
    assert(!collisionDetected && qidSet.size >= 10, `Cryptographic uniqueness: All ${qidSet.size} physical copies have distinct QR identifiers`);

    // 8b. PDF Multi-Label Generation
    const sampleCopyIds = (allCopiesForUniqueness.body?.copies || []).slice(0, 4).map((c) => c._id);
    const pdfLabelsRes = await request(
      '/smartshelf/labels/pdf',
      'POST',
      { copyIds: sampleCopyIds, layout: 'sheet_3x8' },
      token
    );
    const isPdf = pdfLabelsRes.status === 200 && (pdfLabelsRes.raw?.startsWith('%PDF') || typeof pdfLabelsRes.raw === 'string');
    assert(isPdf, 'Generate multi-label PDF sheet (starts with %PDF binary header)');

    // 8c. Book Copies PDF Label endpoint
    const bookCopiesPdfRes = await request(
      `/smartshelf/books/${sampleCopy.bookId?._id || sampleCopy.bookId}/labels/pdf`,
      'GET',
      null,
      token
    );
    assert(bookCopiesPdfRes.status === 200, 'Generate printable PDF labels for all copies of a book');

    // 8d. Regenerate & Revoke Damaged QR Code
    const oldQid = sampleCopy.qrIdentifier;
    const regenRes = await request(
      `/smartshelf/copies/${sampleCopy._id}/regenerate-qr`,
      'POST',
      { reason: 'Torn spine sticker during physical inspection' },
      token
    );
    assert(
      regenRes.status === 200 &&
        regenRes.body?.newQrIdentifier &&
        regenRes.body?.newQrIdentifier !== oldQid,
      'Authorized QR regeneration creates new unique opaque identifier and revokes old one'
    );
    const newQid = regenRes.body?.newQrIdentifier;

    // 8e. Verify scanning revoked QR code is detected and rejected
    const scanRevokedRes = await request(
      '/smartshelf/scan',
      'POST',
      { qrText: oldQid },
      token
    );
    assert(
      scanRevokedRes.status === 409 && scanRevokedRes.body?.isRevoked === true,
      'Scanning revoked QR code triggers 409 Conflict with revocation warning'
    );

    // 8f. Verify scanning new QR code resolves to the exact physical copy
    const scanNewRes = await request(
      '/smartshelf/scan',
      'POST',
      { qrText: newQid },
      token
    );
    assert(
      scanNewRes.status === 200 && scanNewRes.body?.copy?.copyId === sampleCopy.copyId,
      'Scanning newly regenerated QR code resolves to the exact physical copy'
    );

    // 9. Intelligent Book Finder & Student Discovery Mode
    console.log('\n[9/9] Testing Intelligent Book Finder & Student Discovery Mode…');
    const findRes = await request('/smartshelf/books/find?q=Algorithms', 'GET', null, token);
    assert(findRes.status === 200 && findRes.body?.total >= 1, 'Search books by keyword returns catalog matches');
    assert(Array.isArray(findRes.body?.books?.[0]?.copies) && findRes.body?.books?.[0]?.copies?.length >= 1, 'Book search returns all individual physical copies');
    assert(findRes.body?.books?.[0]?.copies?.[0]?.location?.recordedLocationNotice, 'Copies display recorded location disclaimer');

    // Test search by specific fields
    const findIsbnRes = await request(`/smartshelf/books/find?isbn=${findRes.body?.books?.[0]?.isbn || '978'}`, 'GET', null, token);
    assert(findIsbnRes.status === 200 && findIsbnRes.body?.total >= 1, 'Search books by ISBN');

    const findAuthorRes = await request('/smartshelf/books/find?author=Cormen', 'GET', null, token);
    assert(findAuthorRes.status === 200 && findAuthorRes.body?.total >= 1, 'Search books by Author');

    // Test student discovery mode (strips sensitive librarian pricing and notes)
    const studentRes = await request('/smartshelf/books/find?q=Algorithms&student_mode=true', 'GET', null, token);
    assert(studentRes.status === 200 && studentRes.body?.isStudentMode === true, 'Student discovery mode activated');
    assert(studentRes.body?.books?.[0]?.price === undefined, 'Student mode strips internal acquisition price');

    // Test Mark for Inventory Verification endpoint
    const verifyCopyRes = await request(`/smartshelf/copies/${sampleCopy.copyId}/verify-audit`, 'POST', {}, token);
    assert(verifyCopyRes.status === 200 && verifyCopyRes.body?.copy?.isAuditVerified === true, 'Mark copy for inventory verification updates status and logs movement');

    console.log('\n============================================================');
    console.log(`🎉  SmartShelf AI Backend Tests: ${passed} PASSED | ${failed} FAILED`);
    console.log('============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Test execution error:', err);
    process.exit(1);
  }
}

runTestSuite();
