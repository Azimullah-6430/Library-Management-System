'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/report.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/summary', ctrl.getSummary);
router.get('/full', ctrl.getFullReport);

module.exports = router;
