'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Book = require('../models/Book');

const EXPORTS_DIR = path.resolve(__dirname, '../../exports');
const EXCEL_FILE_PATH = path.join(EXPORTS_DIR, 'crescent_library_inventory.xlsx');

/**
 * Automatically regenerates and saves the live inventory Excel workbook on disk.
 */
const syncInventoryToExcel = async () => {
  try {
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const books = await Book.find().sort({ acc: 1 }).lean();

    const rows = books.map((b, idx) => ({
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
      'Copies': b.copies || 1,
      'Total Value (INR)': (b.price || 0) * (b.copies || 1),
      'Shelf': b.shelf || '',
      'Rack / Row': b.row || '',
      'Condition': b.cond || 'Good',
      'Status': b.status || 'Available',
      'Vendor': b.vendor || '',
      'Invoice No': b.invoice || '',
      'Date Acquired': b.date || '',
      'Description / Notes': b.notes || '',
      'Front Cover File': b.frontCover || '',
      'Back Cover File': b.backCover || '',
      'Recorded Date': b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : '',
    }));

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

    // Column formatting for Excel
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 36 },
      { wch: 26 },
      { wch: 20 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
      { wch: 12 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 30 },
      { wch: 25 },
      { wch: 25 },
      { wch: 14 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Library Inventory');
    XLSX.writeFile(workbook, EXCEL_FILE_PATH);

    return { filePath: EXCEL_FILE_PATH, totalBooks: books.length };
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
