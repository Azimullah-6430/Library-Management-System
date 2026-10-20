'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/importExport.controller');
const { protect } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');

router.use(protect);

router.get('/export', ctrl.exportCsv);
router.get('/excel', ctrl.exportExcel);
router.get('/template', ctrl.getTemplate);
router.post('/preview', uploadCsv, ctrl.previewImport);
router.post('/import', uploadCsv, ctrl.importCsv);

module.exports = router;
