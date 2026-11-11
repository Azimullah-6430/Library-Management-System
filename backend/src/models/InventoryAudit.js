'use strict';
const mongoose = require('mongoose');

const AUDIT_SESSION_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const inventoryAuditSchema = new mongoose.Schema(
  {
    auditNumber: {
      type: String,
      required: [true, 'Audit number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
      // Format: AUD-YYYYMM-XXXX (e.g., "AUD-202611-0001")
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryLocation',
      required: [true, 'Target location reference is required'],
      index: true,
    },
    locationCode: {
      type: String,
      trim: true,
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Librarian reference is required'],
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: AUDIT_SESSION_STATUSES,
      default: 'IN_PROGRESS',
      index: true,
    },
    scope: {
      type: { type: String, enum: ['SHELF', 'SECTION', 'FLOOR', 'BUILDING'], default: 'SHELF' },
      building: String,
      floor: String,
      section: String,
      shelf: String,
    },
    expectedCopies: [
      {
        type: String,
        trim: true,
      },
    ],
    expectedDetails: [
      {
        copyId: String,
        bookTitle: String,
        author: String,
        accessionNumber: String,
        condition: String,
        status: String,
      },
    ],
    scannedCopies: [
      {
        type: String,
        trim: true,
      },
    ],
    matchedCopies: [
      {
        type: String,
        trim: true,
      },
    ],
    verifiedCopies: [
      {
        copyIdentifier: String,
        bookTitle: String,
        author: String,
        scannedAt: { type: Date, default: Date.now },
        scanId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryAuditScan' },
      },
    ],
    misplacedCopies: [
      {
        copyIdentifier: String,
        bookTitle: String,
        author: String,
        recordedLocationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'LibraryLocation',
        },
        recordedLocationCode: String,
        foundLocationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'LibraryLocation',
        },
        foundLocationCode: String,
        scannedAt: { type: Date, default: Date.now },
        isResolved: { type: Boolean, default: false },
        resolutionAction: String,
        resolvedAt: Date,
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    unknownScans: [
      {
        rawText: String,
        scannedAt: { type: Date, default: Date.now },
        isResolved: { type: Boolean, default: false },
        resolutionAction: String,
        resolvedAt: Date,
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    duplicateScans: [
      {
        copyIdentifier: String,
        bookTitle: String,
        scannedAt: { type: Date, default: Date.now },
        count: { type: Number, default: 1 },
      },
    ],
    missingCopies: [
      {
        copyIdentifier: String,
        bookTitle: String,
        author: String,
        accessionNumber: String,
        status: String,
        isResolved: { type: Boolean, default: false },
        resolutionAction: String,
        resolvedAt: Date,
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    pendingVerificationCopies: [
      {
        copyIdentifier: String,
        bookTitle: String,
        author: String,
        reason: String,
        scannedAt: { type: Date, default: Date.now },
        isResolved: { type: Boolean, default: false },
        resolutionAction: String,
        resolvedAt: Date,
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    resolutions: [
      {
        itemType: String,
        copyIdentifier: String,
        action: String,
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        performedAt: { type: Date, default: Date.now },
        notes: String,
      },
    ],
    summary: {
      totalExpected: { type: Number, default: 0 },
      totalScanned: { type: Number, default: 0 },
      uniqueScanned: { type: Number, default: 0 },
      verifiedCount: { type: Number, default: 0 },
      matchedCount: { type: Number, default: 0 },
      misplacedCount: { type: Number, default: 0 },
      unknownCount: { type: Number, default: 0 },
      duplicateCount: { type: Number, default: 0 },
      missingCount: { type: Number, default: 0 },
      pendingVerificationCount: { type: Number, default: 0 },
      accuracyRate: { type: Number, default: 100 },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('InventoryAudit', inventoryAuditSchema);
module.exports.AUDIT_SESSION_STATUSES = AUDIT_SESSION_STATUSES;

