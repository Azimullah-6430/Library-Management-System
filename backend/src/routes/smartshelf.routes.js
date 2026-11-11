'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/smartshelf.controller');
const { protect, authorize } = require('../middleware/auth');

// All SmartShelf routes require valid JWT authentication
router.use(protect);

// ── Locations ────────────────────────────────────────────────────────────────
router.get('/locations', ctrl.getLocations);
router.get('/locations/meta', ctrl.getLocationMeta);
router.get('/locations/tree', ctrl.getLocationTree);
router.get('/locations/:id', ctrl.getLocationById);
router.get('/locations/:id/counts', ctrl.getLocationInventoryCounts);
router.get('/locations/:id/qr', ctrl.getLocationQr);
router.post('/locations', authorize('librarian', 'admin'), ctrl.createLocation);
router.patch('/locations/:id', authorize('librarian', 'admin'), ctrl.updateLocation);
router.patch('/locations/:id/deactivate', authorize('librarian', 'admin'), ctrl.deactivateLocation);
router.patch('/locations/:id/activate', authorize('librarian', 'admin'), ctrl.activateLocation);

// ── Copies ───────────────────────────────────────────────────────────────────
router.get('/copies', ctrl.getAllCopies);
router.get('/copies/:id', ctrl.getCopyById);
router.get('/copies/:id/location', ctrl.getCopyLocation);
router.get('/copies/:id/qr', ctrl.getCopyQr);
router.get('/copies/:id/qr.png', ctrl.downloadCopyQrPng);
router.get('/copies/:id/qr.svg', ctrl.downloadCopyQrSvg);
router.get('/copies/:id/movements', authorize('librarian', 'admin'), ctrl.getCopyMovementHistory);
router.post('/copies', authorize('librarian', 'admin'), ctrl.createCopies);
router.patch('/copies/:id', authorize('librarian', 'admin'), ctrl.updateCopy);
router.post('/copies/:id/move', authorize('librarian', 'admin'), ctrl.moveCopy);
router.post('/copies/:id/regenerate-qr', authorize('librarian', 'admin'), ctrl.regenerateCopyQr);
router.post('/copies/:id/verify-audit', authorize('librarian', 'admin'), ctrl.markAuditVerification);

// ── Intelligent Book Finder & Discovery ──────────────────────────────────────
router.get('/books/find', ctrl.findBooks);

// ── Printable Labels & PDF Generation ─────────────────────────────────────────
router.get('/labels/layouts', ctrl.getLabelLayouts);
router.post('/labels/pdf', ctrl.generateSelectedLabelsPdf);
router.get('/books/:bookId/labels/pdf', ctrl.getBookCopiesLabelsPdf);

// ── Book-specific Copies ─────────────────────────────────────────────────────
router.get('/books/:bookId/copies', ctrl.getBookCopies);
router.post('/books/:bookId/copies', authorize('librarian', 'admin'), (req, res, next) => {
  req.body.bookId = req.params.bookId;
  ctrl.createCopies(req, res, next);
});

// ── Movements ────────────────────────────────────────────────────────────────
router.get('/movements', authorize('librarian', 'admin'), ctrl.getAllMovements);

// ── Universal QR Scanner & Verification ──────────────────────────────────────
router.post('/scan', ctrl.resolveScan);

// ── Inventory Audits ─────────────────────────────────────────────────────────
router.get('/audits', authorize('librarian', 'admin'), ctrl.getAudits);
router.get('/audits/:auditId', authorize('librarian', 'admin'), ctrl.getAuditById);
router.post('/audits/start', authorize('librarian', 'admin'), ctrl.startAudit);
router.post('/audits/:auditId/scan', authorize('librarian', 'admin'), ctrl.recordAuditScan);
router.post('/audits/:auditId/complete', authorize('librarian', 'admin'), ctrl.completeAudit);
router.post('/audits/:auditId/resolve', authorize('librarian', 'admin'), ctrl.resolveAuditException);
router.get('/audits/:auditId/export', authorize('librarian', 'admin'), ctrl.exportAuditReport);

// ── Global Counts ────────────────────────────────────────────────────────────
router.get('/inventory-counts', ctrl.getGlobalInventoryCounts);

module.exports = router;
