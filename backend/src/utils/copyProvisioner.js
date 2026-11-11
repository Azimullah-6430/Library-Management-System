'use strict';
const BookCopy = require('../models/BookCopy');
const BookMovement = require('../models/BookMovement');
const LibraryLocation = require('../models/LibraryLocation');
const { generateOpaqueQrIdentifier, formatCopyPayload, generateQrDataUrl } = require('./qrCodeHelper');

/**
 * Ensures a Book has individual physical BookCopy records matching its total copies count.
 * Creates any missing copies, generates unique QR codes, and logs initial placement.
 */
const provisionBookCopies = async (book, options = {}) => {
  if (!book || !book._id) return [];

  const targetCount = Math.max(1, parseInt(book.copies, 10) || 1);
  const existingCopies = await BookCopy.find({ bookId: book._id }).sort({ copyNumber: 1 });

  // Resolve initial location if specified on the book
  let locationDoc = null;
  if (options.locationId) {
    locationDoc = await LibraryLocation.findById(options.locationId);
  } else if (book.shelf) {
    // Attempt matching locationCode or shelf in LibraryLocation
    locationDoc = await LibraryLocation.findOne({
      $or: [
        { locationCode: book.shelf.trim().toUpperCase() },
        { shelf: { $regex: new RegExp(`^${book.shelf.trim()}$`, 'i') } },
      ],
      isActive: true,
    });
  }

  const existingCopyNumbers = new Set(existingCopies.map((c) => c.copyNumber));
  const newCopies = [];
  let copyIndex = 1;

  while (existingCopies.length + newCopies.length < targetCount) {
    while (existingCopyNumbers.has(copyIndex)) {
      copyIndex++;
    }

    const copyNumPad = String(copyIndex).padStart(2, '0');
    const copyId = `${book.acc}-C${copyNumPad}`;
    const accessionNumber = copyId;
    const qrIdentifier = generateOpaqueQrIdentifier();
    const qrPayload = formatCopyPayload(qrIdentifier, options.baseUrl);
    const qrCodeDataUrl = await generateQrDataUrl(qrPayload);

    const copyDoc = await BookCopy.create({
      copyId,
      bookId: book._id,
      copyNumber: copyIndex,
      accessionNumber,
      qrIdentifier,
      qrCodeDataUrl,
      locationId: locationDoc ? locationDoc._id : undefined,
      condition: book.cond || 'Good',
      status: book.status === 'Available' ? 'Available' : book.status || 'Available',
      price: book.price || 0,
      barcode: copyId,
      notes: `Auto-provisioned copy #${copyIndex}`,
      createdBy: options.userId || book.createdBy,
      updatedBy: options.userId || book.updatedBy,
    });

    await BookMovement.create({
      copyId: copyDoc._id,
      copyIdentifier: copyDoc.copyId,
      bookId: book._id,
      previousLocationId: null,
      previousLocationCode: 'ACQUISITION',
      newLocationId: locationDoc ? locationDoc._id : null,
      newLocationCode: locationDoc ? locationDoc.locationCode : 'UNASSIGNED',
      performedBy: options.userId || book.createdBy,
      reason: 'INITIAL_PLACEMENT',
      auditStatus: 'VERIFIED',
      remarks: `Initial registration of physical copy ${copyId} for "${book.title}".`,
    });

    existingCopyNumbers.add(copyIndex);
    newCopies.push(copyDoc);
    copyIndex++;
  }

  return [...existingCopies, ...newCopies];
};

module.exports = {
  provisionBookCopies,
};
