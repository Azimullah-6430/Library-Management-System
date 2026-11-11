'use strict';
const mongoose = require('mongoose');

const libraryLocationSchema = new mongoose.Schema(
  {
    locationCode: {
      type: String,
      required: [true, 'Location code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
      // Format: BLD-FLR-SEC-SHF-RCK-ROW (e.g., "LIB-F1-CS-S04-R2-RW3")
    },
    building: {
      type: String,
      required: [true, 'Building name/code is required'],
      trim: true,
      default: 'Central Library',
    },
    floor: {
      type: String,
      required: [true, 'Floor is required'],
      trim: true,
    },
    section: {
      type: String,
      required: [true, 'Section is required'],
      trim: true,
    },
    shelf: {
      type: String,
      required: [true, 'Shelf number is required'],
      trim: true,
    },
    rack: {
      type: String,
      required: [true, 'Rack number is required'],
      trim: true,
    },
    row: {
      type: String,
      required: [true, 'Row identifier is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    capacity: {
      type: Number,
      default: 40,
      min: [1, 'Capacity must be at least 1 book'],
    },
    currentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Maintenance', 'Full'],
      default: 'Active',
      index: true,
    },
    qrIdentifier: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      // Format: CLMS:LOC:<locationCode>
    },
    qrCodeDataUrl: {
      type: String,
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

// Composite index to speed up hierarchical browsing
libraryLocationSchema.index({ building: 1, floor: 1, section: 1, shelf: 1 });

// Helper to auto-generate locationCode if missing
libraryLocationSchema.pre('validate', function (next) {
  if (!this.locationCode && this.building && this.floor && this.shelf) {
    const clean = (s) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    this.locationCode = `${clean(this.building)}-${clean(this.floor)}-${clean(this.section)}-${clean(this.shelf)}-${clean(this.rack)}-${clean(this.row)}`;
  }
  if (!this.qrIdentifier && this.locationCode) {
    this.qrIdentifier = `CLMS:LOC:${this.locationCode}`;
  }
  next();
});

module.exports = mongoose.model('LibraryLocation', libraryLocationSchema);

