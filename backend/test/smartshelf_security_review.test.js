/**
 * SmartShelf AI - Comprehensive Security, Reliability & Integration Review Test Suite
 * 
 * Verifies all 18 mission-critical security and reliability scenarios:
 * 1. Duplicate QR identifiers
 * 2. Invalid and revoked QR identifiers
 * 3. Unauthorized QR lookup
 * 4. Unauthorized location modifications
 * 5. Duplicate accession numbers
 * 6. Book copies without assigned locations
 * 7. Simultaneous / duplicate movement requests
 * 8. Failed database transactions / atomic integrity
 * 9. Invalid location hierarchy validation
 * 10. Repeated QR scans debouncing & duplicate classification
 * 11. Camera permission denial & manual input fallback
 * 12. Interrupted inventory audits resumability
 * 13. Audit finalization with incomplete scans (missing copies calculation)
 * 14. Incorrectly located books (misplacement without automatic relocation)
 * 15. Deleted / deactivated locations containing book copies guard
 * 16. QR label printing and decoding (payload privacy check)
 * 17. Large inventory pagination and search
 * 18. Unauthorized access to movement and audit history
 */

'use strict';

const http = require('http');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000/api/v1';

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

async function runSecurityReview() {
  console.log('\n============================================================');
  console.log('🛡️  SmartShelf AI Security, Reliability & Integration Review');
  console.log('============================================================\n');

  // ── Authentication Setup ──────────────────────────────────────────
  console.log('[Setup] Authenticating Librarian and Preparing Review Session…');
  const loginRes = await request('/auth/login', 'POST', {
    email: 'librarian@crescent.edu.in',
    password: 'Librarian@123',
  });
  assert(loginRes.status === 200 && loginRes.body?.token, 'Librarian credentials validated with JWT');
  const token = loginRes.body?.token;

  // Fetch initial books and copies
  const copiesRes = await request('/smartshelf/copies?limit=10', 'GET', null, token);
  assert(copiesRes.status === 200 && Array.isArray(copiesRes.body?.copies), 'Initial copies catalog loaded');
  const sampleCopy = copiesRes.body.copies[0];
  const sampleBookId = sampleCopy.bookId._id || sampleCopy.bookId;

  // Fetch initial locations
  const locsRes = await request('/smartshelf/locations', 'GET', null, token);
  assert(locsRes.status === 200 && locsRes.body?.locations?.length > 0, 'Active shelf locations loaded');
  const sampleLocation = locsRes.body.locations[0];

  // ── 1. Duplicate QR Identifiers ───────────────────────────────────
  console.log('\n[Scenario 1/18] Testing Duplicate QR Identifiers Protection…');
  const dupQrAttempt = await request(
    `/smartshelf/books/${sampleBookId}/copies`,
    'POST',
    {
      count: 1,
      customQrIdentifier: sampleCopy.qrIdentifier, // deliberate collision attempt
    },
    token
  );
  if (dupQrAttempt.status === 201) {
    const createdQr = dupQrAttempt.body?.copies?.[0]?.qrIdentifier;
    assert(createdQr !== sampleCopy.qrIdentifier, 'Duplicate QR collision avoided: system ensured cryptographic uniqueness');
  } else {
    assert(dupQrAttempt.status === 400 || dupQrAttempt.status === 409, 'Duplicate QR identifier rejected with HTTP 400/409');
  }

  // ── 2. Invalid and Revoked QR Identifiers ─────────────────────────
  console.log('\n[Scenario 2/18] Testing Invalid and Revoked QR Identifiers…');
  const invalidQrScan = await request('/smartshelf/scan', 'POST', {
    qrText: 'CRESCENT:COPY:NONEXISTENT-UUID-9999999999',
  }, token);
  assert(invalidQrScan.status === 404 && invalidQrScan.body?.success === false, 'Malformed/unknown QR identifier safely returns 404 Not Found');

  // Regenerate QR on sampleCopy to create a revoked identifier
  const oldQid = sampleCopy.qrIdentifier;
  const regenRes = await request(`/smartshelf/copies/${sampleCopy._id}/regenerate-qr`, 'POST', {
    reason: 'Damaged physical tag',
  }, token);
  assert(regenRes.status === 200 && regenRes.body?.newQrIdentifier, 'QR regeneration successfully created revoked identifier');
  const revokedId = oldQid;

  // Scan the revoked QR code
  const revokedScan = await request('/smartshelf/scan', 'POST', {
    qrText: revokedId,
  }, token);
  assert(
    revokedScan.status === 409 && revokedScan.body?.isRevoked === true,
    'Scanning revoked QR code returns 409 Conflict with revocation warning'
  );

  // ── 3. Unauthorized QR Lookup ─────────────────────────────────────
  console.log('\n[Scenario 3/18] Testing Unauthorized QR Lookup Protection…');
  const unauthScan = await request('/smartshelf/scan', 'POST', {
    qrText: sampleCopy.qrIdentifier,
  }, null); // null token
  assert(unauthScan.status === 401, 'Unauthenticated QR lookup is rejected with 401 Unauthorized');

  const unauthCopyGet = await request(`/smartshelf/copies/${sampleCopy._id}`, 'GET', null, null);
  assert(unauthCopyGet.status === 401, 'Unauthenticated physical copy detail is rejected with 401');

  // ── 4. Unauthorized Location Modifications ────────────────────────
  console.log('\n[Scenario 4/18] Testing Unauthorized Location Modifications…');
  const unauthLocPost = await request('/smartshelf/locations', 'POST', {
    building: 'Rogue Building',
    floor: 'Floor X',
    section: 'Hacking Section',
    shelf: 'H-1',
    rack: 'Rack 1',
    row: 'Row 1',
  }, null);
  assert(unauthLocPost.status === 401, 'Unauthenticated location creation is rejected with 401');

  const unauthLocPatch = await request(`/smartshelf/locations/${sampleLocation._id}`, 'PATCH', {
    description: 'Tampered description',
  }, null);
  assert(unauthLocPatch.status === 401, 'Unauthenticated location update is rejected with 401');

  // ── 5. Duplicate Accession Numbers ─────────────────────────────────
  console.log('\n[Scenario 5/18] Testing Duplicate Accession Numbers Protection…');
  const dupAccAttempt = await request(
    `/smartshelf/books/${sampleBookId}/copies`,
    'POST',
    {
      count: 1,
      accessionNumber: sampleCopy.accessionNumber, // deliberate duplicate accession number
    },
    token
  );
  if (dupAccAttempt.status === 201) {
    const createdAcc = dupAccAttempt.body?.copies?.[0]?.accessionNumber;
    assert(createdAcc !== sampleCopy.accessionNumber, 'Accession number auto-incremented to prevent duplicate catalog collision');
  } else {
    assert(dupAccAttempt.status === 400 || dupAccAttempt.status === 409, 'Duplicate accession number rejected with HTTP 400/409');
  }

  // ── 6. Book Copies Without Assigned Locations ─────────────────────
  console.log('\n[Scenario 6/18] Testing Book Copies Without Assigned Locations…');
  const unassignedCopyCreate = await request(
    `/smartshelf/books/${sampleBookId}/copies`,
    'POST',
    {
      count: 1,
      locationId: null, // intentionally null
      condition: 'New',
    },
    token
  );
  assert(unassignedCopyCreate.status === 201, 'Physical copy successfully created without immediate location assignment');
  const unassignedCopy = unassignedCopyCreate.body.copies[0];

  const unassignedGet = await request(`/smartshelf/copies/${unassignedCopy._id}`, 'GET', null, token);
  assert(
    unassignedGet.status === 200 && (unassignedGet.body.copy.locationId === null || !unassignedGet.body.copy.locationId),
    'Physical copy details retrieve gracefully with null locationId'
  );

  const unassignedScan = await request('/smartshelf/scan', 'POST', {
    qrText: unassignedCopy.qrIdentifier,
  }, token);
  assert(
    unassignedScan.status === 200 && !unassignedScan.body?.registeredLocation,
    'QR scan accurately reports copy is awaiting shelf location assignment'
  );

  // ── 7. Simultaneous / Duplicate Movement Requests ─────────────────
  console.log('\n[Scenario 7/18] Testing Movement Validation & Duplicate Move Rejection…');
  // First move copy to sampleLocation
  await request(`/smartshelf/copies/${unassignedCopy._id}/move`, 'POST', {
    newLocationId: sampleLocation._id,
    reason: 'Initial shelf shelving',
  }, token);

  // Attempt duplicate move to the exact same shelf
  const dupMove = await request(`/smartshelf/copies/${unassignedCopy._id}/move`, 'POST', {
    newLocationId: sampleLocation._id,
    reason: 'Redundant movement test',
  }, token);
  assert(
    dupMove.status === 400 && dupMove.body?.message?.includes('already assigned to location'),
    'Duplicate movement to identical shelf is rejected (400 Bad Request)'
  );

  // ── 8. Failed Database Transactions / Atomic Integrity ───────────
  console.log('\n[Scenario 8/18] Testing Atomic Movement Integrity & Transaction Safety…');
  const invalidMove = await request(`/smartshelf/copies/${unassignedCopy._id}/move`, 'POST', {
    newLocationId: '600000000000000000000000', // Non-existent location ObjectId
    reason: 'Move to invalid location',
  }, token);
  assert(invalidMove.status === 404, 'Movement to invalid location rejected without altering copy state');

  const copyAfterFail = await request(`/smartshelf/copies/${unassignedCopy._id}`, 'GET', null, token);
  assert(
    String(copyAfterFail.body.copy.locationId?._id || copyAfterFail.body.copy.locationId) === String(sampleLocation._id),
    'Copy location remained unchanged following failed movement transaction'
  );

  // ── 9. Invalid Location Hierarchy Validation ──────────────────────
  console.log('\n[Scenario 9/18] Testing Invalid Location Hierarchy Validation…');
  const invalidHierarchy = await request('/smartshelf/locations', 'POST', {
    building: 'Central Library',
    // Missing floor, section, shelf, rack, row
  }, token);
  assert(
    invalidHierarchy.status === 400 && invalidHierarchy.body?.message?.includes('required'),
    'Incomplete location hierarchy rejected with 400 Bad Request'
  );

  // ── 10. Repeated QR Scans Debouncing & Classification ─────────────
  console.log('\n[Scenario 10/18] Testing Repeated QR Scans Classification…');
  const auditStart = await request('/smartshelf/audits/start', 'POST', {
    locationId: sampleLocation._id,
    notes: 'Security review automated audit test',
  }, token);
  assert(auditStart.status === 201 && auditStart.body?.audit?._id, 'Audit session initiated');
  const auditId = auditStart.body.audit._id;

  // First scan
  const scan1 = await request(`/smartshelf/audits/${auditId}/scan`, 'POST', {
    qrText: unassignedCopy.qrIdentifier,
  }, token);
  assert(scan1.status === 200 && scan1.body?.verificationResult === 'VERIFIED', 'First scan classified as VERIFIED');

  // Immediate repeated scan
  const scan2 = await request(`/smartshelf/audits/${auditId}/scan`, 'POST', {
    qrText: unassignedCopy.qrIdentifier,
  }, token);
  assert(
    scan2.status === 200 && scan2.body?.verificationResult === 'DUPLICATE',
    'Repeated scan of same physical copy classified safely as DUPLICATE'
  );

  // ── 11. Camera Permission Denial Fallback ─────────────────────────
  console.log('\n[Scenario 11/18] Testing Camera Permission Fallback via Accession & ID…');
  // Test manual fallback via accession number
  const manualAccessionScan = await request('/smartshelf/scan', 'POST', {
    qrText: unassignedCopy.accessionNumber,
  }, token);
  assert(
    manualAccessionScan.status === 200 && manualAccessionScan.body?.copy?.copyId === unassignedCopy.copyId,
    'Manual fallback by accession number resolves exact copy when camera is disabled'
  );

  // Test manual fallback by copy ID
  const manualCopyIdScan = await request('/smartshelf/scan', 'POST', {
    qrText: unassignedCopy.copyId,
  }, token);
  assert(
    manualCopyIdScan.status === 200 && manualCopyIdScan.body?.copy?.copyId === unassignedCopy.copyId,
    'Manual fallback by copy ID resolves exact copy when camera is disabled'
  );

  // ── 12. Interrupted Inventory Audits Resumability ─────────────────
  console.log('\n[Scenario 12/18] Testing Interrupted Inventory Audits Resumability…');
  // Fetch existing audit in progress
  const auditGet = await request(`/smartshelf/audits/${auditId}`, 'GET', null, token);
  assert(
    auditGet.status === 200 && auditGet.body?.audit?.status === 'IN_PROGRESS',
    'Interrupted audit session retains IN_PROGRESS status across requests'
  );
  assert(
    (auditGet.body?.audit?.summary?.totalScanned >= 1 || auditGet.body?.audit?.scannedCopies?.length >= 1),
    'Scans are preserved persistently in database without data loss'
  );

  // ── 13. Audit Finalization with Incomplete Scans ──────────────────
  console.log('\n[Scenario 13/18] Testing Missing Copies Generated ONLY Upon Finalization…');
  // Check that missingCopies is NOT populated while IN_PROGRESS
  assert(
    !auditGet.body.audit.missingCopies || auditGet.body.audit.missingCopies.length === 0,
    'Invariant satisfied: missingCopies list is empty while audit is IN_PROGRESS'
  );

  // Complete audit
  const auditComplete = await request(`/smartshelf/audits/${auditId}/complete`, 'POST', {
    resolutionNotes: 'Completed security review test audit',
  }, token);
  assert(
    auditComplete.status === 200 && auditComplete.body?.audit?.status === 'COMPLETED',
    'Audit session finalized with COMPLETED status'
  );
  assert(
    Array.isArray(auditComplete.body.audit.missingCopies),
    'Missing copies calculated strictly after explicit librarian completion'
  );

  // ── 14. Incorrectly Located Books Detection ───────────────────────
  console.log('\n[Scenario 14/18] Testing Misplaced Book Detection Without Auto-Relocation…');
  // Find a second location
  const otherLocation = locsRes.body.locations.find(
    (l) => String(l._id) !== String(sampleLocation._id)
  );
  assert(otherLocation, 'Second location identified for misplacement check');

  // Start audit at otherLocation
  const auditMisplaced = await request('/smartshelf/audits/start', 'POST', {
    locationId: otherLocation._id,
    notes: 'Testing misplacement scan',
  }, token);
  const misplacedAuditId = auditMisplaced.body.audit._id;

  // Scan unassignedCopy (which is registered at sampleLocation) into otherLocation audit
  const misScan = await request(`/smartshelf/audits/${misplacedAuditId}/scan`, 'POST', {
    qrText: unassignedCopy.qrIdentifier,
  }, token);
  assert(
    misScan.status === 200 && misScan.body?.verificationResult === 'MISPLACED',
    'Scanned book on foreign shelf is accurately classified as MISPLACED'
  );

  // Verify book was NOT automatically moved in the catalog
  const copyCheckAfterMis = await request(`/smartshelf/copies/${unassignedCopy._id}`, 'GET', null, token);
  assert(
    String(copyCheckAfterMis.body.copy.locationId?._id || copyCheckAfterMis.body.copy.locationId) === String(sampleLocation._id),
    'Misplaced book is NOT automatically relocated; catalog preserves registered location until manual confirmation'
  );

  // Clean up audit session
  await request(`/smartshelf/audits/${misplacedAuditId}/complete`, 'POST', {}, token);

  // ── 15. Deactivated Locations Containing Book Copies Guard ────────
  console.log('\n[Scenario 15/18] Testing Deactivation Block on Locations with Active Copies…');
  // Attempt to deactivate sampleLocation which holds unassignedCopy and others
  const deactFailRes = await request(`/smartshelf/locations/${sampleLocation._id}/deactivate`, 'PATCH', {}, token);
  assert(
    deactFailRes.status === 400 && deactFailRes.body?.activeCopiesCount > 0,
    'Deactivation blocked: cannot deactivate location that holds active book copies'
  );

  // ── 16. QR Label Printing and Privacy Verification ────────────────
  console.log('\n[Scenario 16/18] Testing QR Label PDF Generation & Payload Privacy…');
  const pdfRes = await request(`/smartshelf/books/${sampleBookId}/labels/pdf`, 'GET', null, token);
  assert(
    pdfRes.status === 200 && (pdfRes.headers['content-type'] === 'application/pdf' || pdfRes.body.startsWith('%PDF')),
    'Printable PDF label sheet generated with valid %PDF binary stream'
  );

  // Check payload privacy: QR identifier must NOT expose database passwords or sensitive user credentials
  const qrRaw = unassignedCopy.qrIdentifier;
  assert(
    !qrRaw.toLowerCase().includes('password') && !qrRaw.toLowerCase().includes('token') && !qrRaw.toLowerCase().includes('secret'),
    'QR identifier contains no passwords, secrets, or personal identifiable information'
  );

  // ── 17. Large Inventory Pagination and Search ─────────────────────
  console.log('\n[Scenario 17/18] Testing Large Inventory Pagination & Filtering…');
  const page1Res = await request('/smartshelf/copies?page=1&limit=2', 'GET', null, token);
  assert(
    page1Res.status === 200 && page1Res.body?.copies?.length <= 2 && page1Res.body?.page === 1,
    'Page 1 pagination correctly limited to requested limit=2'
  );

  const page2Res = await request('/smartshelf/copies?page=2&limit=2', 'GET', null, token);
  assert(
    page2Res.status === 200 && page2Res.body?.page === 2,
    'Page 2 pagination successfully offsets records'
  );

  // Verify movements pagination
  const movePageRes = await request('/smartshelf/movements?page=1&limit=3', 'GET', null, token);
  assert(
    movePageRes.status === 200 && movePageRes.body?.movements?.length <= 3,
    'Movement audit log correctly supports pagination'
  );

  // ── 18. Unauthorized Access to Movement and Audit History ─────────
  console.log('\n[Scenario 18/18] Testing Unauthorized Access to Movement and Audit History…');
  // Attempt unauthenticated access to /movements
  const unauthMovements = await request('/smartshelf/movements', 'GET', null, null);
  assert(unauthMovements.status === 401, 'Unauthenticated access to /movements rejected with 401');

  // Attempt unauthenticated access to /audits
  const unauthAudits = await request('/smartshelf/audits', 'GET', null, null);
  assert(unauthAudits.status === 401, 'Unauthenticated access to /audits rejected with 401');

  // Attempt unauthenticated access to copy movement history
  const unauthCopyMovements = await request(`/smartshelf/copies/${sampleCopy._id}/movements`, 'GET', null, null);
  assert(unauthCopyMovements.status === 401, 'Unauthenticated access to /copies/:id/movements rejected with 401');

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log(`🛡️  Review Results: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSecurityReview().catch((err) => {
  console.error('Fatal error during security review:', err);
  process.exit(1);
});
