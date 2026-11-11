'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Book = require('../models/Book');
const BookCopy = require('../models/BookCopy');
const LibraryLocation = require('../models/LibraryLocation');

const EXPORTS_DIR = path.resolve(__dirname, '../../exports');
const EXCEL_FILE_PATH = path.join(EXPORTS_DIR, 'crescent_library_inventory.xlsx');

/**
 * Automatically regenerates and saves the live inventory Excel workbook on disk.
 * Includes both high-level catalog titles and individual copy-level accession & location data.
 */
const syncInventoryToExcel = async () => {
  try {
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const [books, copies] = await Promise.all([
      Book.find().sort({ acc: 1 }).lean(),
      BookCopy.find({ isDeleted: false })
        .populate('bookId', 'title author isbn cat acc')
        .populate('locationId')
        .sort({ copyId: 1 })
        .lean(),
    ]);

    // Build map of physical locations per book
    const bookCopiesMap = {};
    copies.forEach((c) => {
      const bId = c.bookId?._id ? c.bookId._id.toString() : (c.bookId?.toString() || '');
      if (!bookCopiesMap[bId]) bookCopiesMap[bId] = [];
      bookCopiesMap[bId].push(c);
    });

    const rows = books.map((b, idx) => {
      const bCopies = bookCopiesMap[b._id.toString()] || [];
      const shelfCodes = [...new Set(bCopies.map((cp) => cp.locationId?.locationCode).filter(Boolean))].join(', ');
      return {
        'S.No': idx + 1,
        'Accession No': b.acc || '',
        'Book Title': b.title || '',
        'Author(s)': b.author || '',
        'Additional Authors': b.addl || '',
        'ISBN': b.isbn || '',
        'Category': b.cat || 'General',
        'Publisher': b.publisher || '',
        'Edition': b.edition || '',
        'Year': b.year || '',
        'Language': b.lang || 'English',
        'Format': b.format || 'Hardcover',
        'Price (INR)': b.price || 0,
        'Catalog Copies': b.copies || 1,
        'Physical Copies Registered': bCopies.length || b.copies || 1,
        'Total Value (INR)': (b.price || 0) * (b.copies || 1),
        'Shelf': b.shelf || '',
        'Rack / Row': b.row || '',
        'Physical Locations': shelfCodes || b.shelf || 'UNASSIGNED',
        'Condition': b.cond || 'Good',
        'Status': b.status || 'Available',
        'Vendor': b.vendor || '',
        'Invoice No': b.invoice || '',
        'Date Acquired': b.date || '',
        'Description / Notes': b.notes || '',
        'Front Cover File': b.frontCover || '',
        'Back Cover File': b.backCover || '',
        'Recorded Date': b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(
      rows.length
        ? rows
        : [
            {
              'S.No': 1,
              'Accession No': '',
              'Book Title': 'Inventory initialized. Add your first book.',
              'Author(s)': '',
              'Category': '',
              'Price (INR)': 0,
              'Copies': 0,
              'Status': 'Available',
            },
          ]
    );

    // Copy-level sheet rows
    const copyRows = copies.map((c, idx) => {
      const loc = c.locationId || {};
      return {
        'S.No': idx + 1,
        'Copy Identifier': c.copyId,
        'Copy Accession No': c.accessionNumber || '',
        'Catalog Accession No': c.bookId?.acc || '',
        'Book Title': c.bookId?.title || '',
        'Author(s)': c.bookId?.author || '',
        'ISBN': c.bookId?.isbn || '',
        'Category': c.bookId?.cat || '',
        'QR Identifier': c.qrIdentifier || '',
        'Barcode': c.barcode || '',
        'Location Code': loc.locationCode || 'UNASSIGNED',
        'Building': loc.building || '',
        'Floor': loc.floor || '',
        'Section': loc.section || '',
        'Shelf': loc.shelf || '',
        'Rack': loc.rack || '',
        'Row': loc.row || '',
        'Condition': c.condition || 'Good',
        'Status': c.status || 'Available',
        'Misplaced?': c.isMisplaced ? 'YES' : 'NO',
        'Last Audit Date': c.lastAuditDate ? new Date(c.lastAuditDate).toISOString().slice(0, 10) : 'Never',
        'Created At': c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '',
      };
    });

    const copyWorksheet = XLSX.utils.json_to_sheet(
      copyRows.length
        ? copyRows
        : [
            {
              'S.No': 1,
              'Copy Identifier': 'None',
              'Copy Accession No': 'None',
              'Book Title': 'No physical copies registered yet',
            },
          ]
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Catalog Inventory');
    XLSX.utils.book_append_sheet(workbook, copyWorksheet, 'Physical Copies & Locations');
    XLSX.writeFile(workbook, EXCEL_FILE_PATH);

    return { filePath: EXCEL_FILE_PATH, totalBooks: books.length, totalCopies: copies.length };
  } catch (err) {
    console.error('Error syncing inventory to Excel:', err);
    return null;
  }
};

module.exports = {
  syncInventoryToExcel,
  EXCEL_FILE_PATH,
  EXPORTS_DIR,
};
