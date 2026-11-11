'use strict';
const mongoose = require('mongoose');

const COPY_CONDITIONS = ['New', 'Good', 'Fair', 'Poor', 'Damaged'];
const COPY_STATUSES = [
  'Available',
  'Issued',
  'Reserved',
  'In-Transit',
  'Misplaced',
  'Lost',
  'Damaged',
  'Under-Audit',
  'Withdrawn',
];

const bookCopySchema = new mongoose.Schema(
  {
    copyId: {
      type: String,
      required: [true, 'Copy ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
      // Format: <BOOK_ACCESSION>-C<COPY_NUMBER> (e.g. "ACC-0001-C01")
    },
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: [true, 'Book record reference is required'],
      index: true,
    },
    copyNumber: {
      type: Number,
      required: [true, 'Copy number is required'],
      min: [1, 'Copy number must be at least 1'],
    },
    accessionNumber: {
      type: String,
      required: [true, 'Accession number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    qrIdentifier: {
      type: String,
      required: [true, 'QR identifier is required'],
      unique: true,
      trim: true,
      index: true,
      // Format: Cryptographically random opaque identifier (e.g. CLMS-QID-9E2F4A1B8C0D6E7F8A9B)
    },
    qrCodeDataUrl: {
      type: String,
    },
    revokedQrIdentifiers: [
      {
        qrIdentifier: { type: String, trim: true },
        revokedAt: { type: Date, default: Date.now },
        revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String, trim: true },
      },
    ],
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
      index: true,
    },
    condition: {
      type: String,
      enum: COPY_CONDITIONS,
      default: 'Good',
    },
    status: {
      type: String,
      enum: COPY_STATUSES,
      default: 'Available',
      index: true,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    barcode: {
      type: String,
      trim: true,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
    lastAuditedAt: {
      type: Date,
    },
    lastAuditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isMisplaced: {
      type: Boolean,
      default: false,
      index: true,
    },
    misplacedDetectedLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Prevent duplicate copy number under the same book record
bookCopySchema.index({ bookId: 1, copyNumber: 1 }, { unique: true });

const crypto = require('crypto');

// Auto-fill identifiers if missing
bookCopySchema.pre('validate', function (next) {
  if (!this.accessionNumber && this.copyId) {
    this.accessionNumber = this.copyId;
  }
  if (!this.qrIdentifier) {
    this.qrIdentifier = `CLMS-QID-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('BookCopy', bookCopySchema);
module.exports.COPY_CONDITIONS = COPY_CONDITIONS;
module.exports.COPY_STATUSES = COPY_STATUSES;
