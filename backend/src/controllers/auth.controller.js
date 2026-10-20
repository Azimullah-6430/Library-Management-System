'use strict';
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
    user: user.toPublic(),
  });
};

/**
 * POST /api/v1/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, staffId, staff_id, department } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      staffId: staffId || staff_id,
      department: department || 'Central Library',
      role: 'librarian',
    });

    sendTokenResponse(res, 201, user, 'Librarian account created successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email address or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account is deactivated. Please contact the administrator.' });
    }

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
    const user = await User.findById(req.user.id);
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
    const user = await User.findById(req.user.id);

    if (name) user.name = name.trim();
    if (staffId || staff_id) user.staffId = (staffId || staff_id).trim();
    if (department) user.department = department.trim();

    await user.save();
    res.json({ success: true, message: 'Profile updated.', user: user.toPublic() });
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

    const user = await User.findById(req.user.id).select('+password');
    if (!(await user.matchPassword(current))) {
      return res.status(400).json({ success: false, message: 'Current password does not match.' });
    }

    user.password = nextPw;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};

