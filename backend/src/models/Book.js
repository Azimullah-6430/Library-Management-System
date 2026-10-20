'use strict';
const mongoose = require('mongoose');

const STATUSES = ['Available', 'Issued', 'Reserved', 'Lost', 'Damaged', 'Withdrawn'];
const FORMATS = ['Hardcover', 'Paperback', 'Reference', 'Journal'];
const CONDITIONS = ['New', 'Good', 'Fair', 'Poor'];

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Book title is required'],
      trim: true,
      maxlength: [500, 'Title cannot exceed 500 characters'],
    },
    acc: {
      type: String,
      required: [true, 'Accession number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [50, 'Accession number cannot exceed 50 characters'],
    },
    isbn: {
      type: String,
      trim: true,
      maxlength: [20, 'ISBN cannot exceed 20 characters'],
    },
    author: {
      type: String,
      trim: true,
      maxlength: [300, 'Author cannot exceed 300 characters'],
    },
    addl: {
      type: String,
      trim: true,
      maxlength: [300, 'Additional authors cannot exceed 300 characters'],
    },
    publisher: {
      type: String,
      trim: true,
      maxlength: [200, 'Publisher cannot exceed 200 characters'],
    },
    edition: {
      type: String,
      trim: true,
      maxlength: [50, 'Edition cannot exceed 50 characters'],
    },
    year: {
      type: Number,
      min: 0,
      max: 9999,
    },
    lang: {
      type: String,
      trim: true,
      default: 'English',
      maxlength: [50, 'Language cannot exceed 50 characters'],
    },
    format: {
      type: String,
      enum: FORMATS,
      default: 'Hardcover',
    },
    cat: {
      type: String,
      trim: true,
      index: true,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    copies: {
      type: Number,
      min: 1,
      default: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Copies must be an integer',
      },
    },
    shelf: {
      type: String,
      trim: true,
      maxlength: [50, 'Shelf cannot exceed 50 characters'],
    },
    row: {
      type: String,
      trim: true,
      maxlength: [50, 'Row cannot exceed 50 characters'],
    },
    date: {
      type: String,
      trim: true,
    },
    vendor: {
      type: String,
      trim: true,
      maxlength: [200, 'Vendor cannot exceed 200 characters'],
    },
    invoice: {
      type: String,
      trim: true,
      maxlength: [100, 'Invoice cannot exceed 100 characters'],
    },
    cond: {
      type: String,
      enum: CONDITIONS,
      default: 'Good',
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'Available',
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
    frontCover: {
      type: String,
      default: '',
    },
    backCover: {
      type: String,
      default: '',
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

// Full-text search index
bookSchema.index({
  title: 'text',
  author: 'text',
  isbn: 'text',
  acc: 'text',
  publisher: 'text',
});

// Total inventory value virtual
bookSchema.virtual('totalValue').get(function () {
  return (this.price || 0) * (this.copies || 1);
});

module.exports = mongoose.model('Book', bookSchema);
module.exports.STATUSES = STATUSES;
module.exports.FORMATS = FORMATS;
module.exports.CONDITIONS = CONDITIONS;
