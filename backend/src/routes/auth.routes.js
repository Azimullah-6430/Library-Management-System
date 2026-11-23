'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

// Public authentication routes
router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/google', ctrl.googleLogin);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password/:token', ctrl.resetPassword);
router.post('/reset-password', ctrl.resetPassword);
router.post('/logout', ctrl.logout);

// Protected routes (requires valid JWT token)
router.use(protect);
router.get('/me', ctrl.getMe);
router.patch('/me', ctrl.updateMe);
router.post('/change-password', ctrl.changePassword);

module.exports = router;
