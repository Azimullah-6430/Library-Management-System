'use strict';
const mongoose = require('mongoose');

const VERIFICATION_RESULTS = [
  'VERIFIED',
  'MISPLACED',
  'UNKNOWN',
  'DUPLICATE',
  'MISSING',
  'PENDING_VERIFICATION',
  'MATCHED',
  'UNEXPECTED',
  'DAMAGED',
];

const inventoryAuditScanSchema = new mongoose.Schema(
  {
    auditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryAudit',
      required: [true, 'Audit session reference is required'],
      index: true,
    },
    copyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookCopy',
      index: true,
    },
    copyIdentifier: {
      type: String,
      trim: true,
    },
    rawInput: {
      type: String,
      trim: true,
    },
    scanTimestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    scannedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Librarian reference is required'],
      index: true,
    },
    recordedLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
      required: [true, 'Location where book was scanned is required'],
    },
    homeLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
    },
    verificationResult: {
      type: String,
      enum: VERIFICATION_RESULTS,
      required: [true, 'Verification result is required'],
      index: true,
    },
    isResolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolutionAction: {
      type: String,
      trim: true,
    },
    resolvedAt: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Prevent scanning duplicate copies repeatedly in the same audit session unless intended
inventoryAuditScanSchema.index({ auditId: 1, copyId: 1 });

module.exports = mongoose.model('InventoryAuditScan', inventoryAuditScanSchema);
module.exports.VERIFICATION_RESULTS = VERIFICATION_RESULTS;

