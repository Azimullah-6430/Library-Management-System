'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'crescent_library_jwt_secret_key_change_in_production',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const sendTokenResponse = (res, statusCode, user, message) => {
  const token = signToken(user._id);
  res.status(statusCode).json({
    success: true,
    message,
    token,
    access_token: token,
    user: typeof user.toPublic === 'function' ? user.toPublic() : user,
  });
};

const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * POST /api/v1/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    const name = (req.body.name || req.body.fullName || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = req.body.password || req.body.pw || '';
    const confirmPassword = req.body.confirmPassword || req.body.confirm_password || req.body.pw2 || '';
    const rawStaffId = (req.body.staffId || req.body.staff_id || '').trim();
    const department = (req.body.department || 'Central Library').trim();

    // 1. Validate required fields
    if (!name) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }
    if (!email) {
      return res.status(400).json({ success: false, message: 'Institutional email is required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid institutional email address.' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    // 2. Validate password confirmation if supplied
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Password and confirm password do not match.' });
    }

    // 3. Enforce email uniqueness
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'An account with this institutional email address already exists. Please sign in.',
      });
    }

    // 4. Enforce Staff / Faculty ID uniqueness if provided
    let staffId = undefined;
    if (rawStaffId) {
      staffId = rawStaffId.toUpperCase();
      const existingStaff = await User.findOne({ staffId });
      if (existingStaff) {
        return res.status(409).json({
          success: false,
          message: `Staff / Faculty ID "${staffId}" is already registered by another librarian.`,
        });
      }
    }

    // 5. Create user record with bcrypt hashing
    const user = await User.create({
      name,
      email,
      password,
      staffId,
      department,
      role: 'librarian',
    });

    sendTokenResponse(res, 201, user, 'Librarian account created successfully. Welcome to Crescent Library.');
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({
        success: false,
        message: `An account with this ${field === 'staffId' ? 'Staff ID' : field} already exists.`,
      });
    }
    next(err);
  }
};

/**
 * POST /api/v1/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password || req.body.pw || '';

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both institutional email and password.',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
      });
    }

    // Retrieve user and explicitly select password hash
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    // Verify password hash
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    // Check account status
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your librarian account is deactivated. Please contact the Chief Librarian or Administrator.',
      });
    }

    // Update lastLogin timestamp without re-triggering full validation
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(res, 200, user, 'Logged in successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/auth/me
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user: user.toPublic(), data: user.toPublic() });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/auth/me
 */
exports.updateMe = async (req, res, next) => {
  try {
    const { name, staffId, staff_id, department } = req.body;
    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (name) user.name = name.trim();
    if (department) user.department = department.trim();

    const newStaffId = (staffId || staff_id || '').trim().toUpperCase();
    if (newStaffId && newStaffId !== user.staffId) {
      const existing = await User.findOne({ staffId: newStaffId, _id: { $ne: user._id } });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Staff ID "${newStaffId}" is already registered to another user.`,
        });
      }
      user.staffId = newStaffId;
    }

    await user.save();
    res.json({ success: true, message: 'Profile updated successfully.', user: user.toPublic() });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/change-password
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { old_password, oldPassword, new_password, newPassword } = req.body;
    const current = old_password || oldPassword;
    const nextPw = new_password || newPassword;

    if (!current || !nextPw) {
      return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
    }
    if (nextPw.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });
    }

    const user = await User.findById(req.user.id || req.user._id).select('+password');
    if (!user || !(await user.matchPassword(current))) {
      return res.status(400).json({ success: false, message: 'Current password does not match.' });
    }

    user.password = nextPw;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/forgot-password
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid institutional email address.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Return neutral message to avoid user enumeration
      return res.json({
        success: true,
        message: 'If an account exists with this email address, password reset instructions have been generated.',
      });
    }

    // Generate single-use reset token
    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // In a production email-connected environment, an email would be sent with the reset link.
    // For local and institutional testing, we return the resetToken securely in response.
    res.json({
      success: true,
      message: 'Password reset link generated successfully. Link is valid for 1 hour.',
      resetToken,
      resetUrl: `#/reset-password/${resetToken}`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/reset-password/:token
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const rawToken = req.params.token || req.body.token;
    const password = req.body.password || req.body.pw;
    const confirmPassword = req.body.confirmPassword || req.body.pw2;

    if (!rawToken) {
      return res.status(400).json({ success: false, message: 'Reset token is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });
    }
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    // Hash the token from URL to compare against stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired. Please request a new link.',
      });
    }

    // Update password and clear reset token
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    sendTokenResponse(res, 200, user, 'Password reset successful. You are now signed in with your new password.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/logout
 */
exports.logout = async (_req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
};
