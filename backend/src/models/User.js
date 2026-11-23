'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Institutional email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please enter a valid institutional email address',
      ],
      index: true,
    },
    password: {
      type: String,
      required: [
        function () {
          return !this.googleId;
        },
        'Password is required',
      ],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't return password hash by default
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ['librarian', 'admin'],
      default: 'librarian',
    },
    staffId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      maxlength: [50, 'Staff ID cannot exceed 50 characters'],
      index: true,
    },
    department: {
      type: String,
      trim: true,
      default: 'Central Library',
      maxlength: [100, 'Department cannot exceed 100 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

// Generate crypto-secure password reset token
userSchema.methods.generatePasswordResetToken = function () {
  // Generate random token
  const rawToken = crypto.randomBytes(32).toString('hex');

  // Hash token and set to resetPasswordToken field (single-use)
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  // Set expiration: 1 hour from now
  this.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

  return rawToken;
};

// Safe public user projection
userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    staffId: this.staffId,
    department: this.department,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin,
  };
};

module.exports = mongoose.model('User', userSchema);
