'use strict';
const mongoose = require('mongoose');

const MOVEMENT_REASONS = [
  'INITIAL_PLACEMENT',
  'RELOCATION',
  'CHECKOUT',
  'CHECKIN',
  'AUDIT_RECONCILIATION',
  'MAINTENANCE_RETURN',
  'DAMAGED_TRANSFER',
  'SHELF_CONSOLIDATION',
  'MANUAL_OVERRIDE',
];

const AUDIT_STATUSES = ['VERIFIED', 'MISPLACED', 'PENDING', 'RECONCILED'];

const bookMovementSchema = new mongoose.Schema(
  {
    copyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookCopy',
      required: [true, 'Book copy reference is required'],
      index: true,
    },
    copyIdentifier: {
      type: String,
      required: [true, 'Copy identifier is required'],
      trim: true,
      index: true,
    },
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: [true, 'Book record reference is required'],
      index: true,
    },
    previousLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
    },
    previousLocationCode: {
      type: String,
      trim: true,
    },
    newLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
    },
    newLocationCode: {
      type: String,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Librarian reference is required'],
      index: true,
    },
    reason: {
      type: String,
      enum: MOVEMENT_REASONS,
      default: 'RELOCATION',
      required: true,
    },
    auditStatus: {
      type: String,
      enum: AUDIT_STATUSES,
      default: 'VERIFIED',
    },
    remarks: {
      type: String,
      trim: true,
      maxlength: [1000, 'Remarks cannot exceed 1000 characters'],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Chronological history index for quick audit lookups
bookMovementSchema.index({ copyId: 1, timestamp: -1 });
bookMovementSchema.index({ newLocationId: 1, timestamp: -1 });

module.exports = mongoose.model('BookMovement', bookMovementSchema);
module.exports.MOVEMENT_REASONS = MOVEMENT_REASONS;
module.exports.AUDIT_STATUSES = AUDIT_STATUSES;

