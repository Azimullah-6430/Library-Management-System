'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/register', ctrl.register);
router.post('/login', ctrl.login);

// Protected routes
router.use(protect);
router.get('/me', ctrl.getMe);
router.patch('/me', ctrl.updateMe);
router.post('/change-password', ctrl.changePassword);

module.exports = router;
