'use strict';
const fs = require('fs');
const Book = require('../models/Book');
const Category = require('../models/Category');
const { syncInventoryToExcel, EXCEL_FILE_PATH } = require('../utils/excelSync');

const CSV_COLUMNS = [
  'title',
  'acc',
  'isbn',
  'author',
  'addl',
  'publisher',
  'edition',
  'year',
  'cat',
  'lang',
  'format',
  'price',
  'copies',
  'shelf',
  'row',
  'date',
  'vendor',
  'invoice',
  'cond',
  'status',
  'notes',
];

const escapeCsv = (v) => {
  const str = String(v ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const parseCsvBuffer = (buffer) => {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(',')
    .map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // Parse CSV line handling quotes
    const values = [];
    let current = '';
    let inQuotes = false;
    const line = lines[i];

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (inQuotes) {
        if (char === '"' && line[j + 1] === '"') {
          current += '"';
          j++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    values.push(current.trim());

    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || '';
    });
    rows.push(rowObj);
  }
  return rows;
};

/**
 * GET /api/v1/import-export/export
 */
exports.exportCsv = async (_req, res, next) => {
  try {
    const books = await Book.find().sort({ acc: 1 }).lean();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="crescent_library_inventory.csv"');

    // Header row
    res.write(CSV_COLUMNS.join(',') + '\n');

    books.forEach((b) => {
      const row = [
        escapeCsv(b.title),
        escapeCsv(b.acc),
        escapeCsv(b.isbn),
        escapeCsv(b.author),
        escapeCsv(b.addl),
        escapeCsv(b.publisher),
        escapeCsv(b.edition),
        escapeCsv(b.year),
        escapeCsv(b.cat),
        escapeCsv(b.lang || 'English'),
        escapeCsv(b.format || 'Hardcover'),
        escapeCsv(b.price || 0),
        escapeCsv(b.copies || 1),
        escapeCsv(b.shelf),
        escapeCsv(b.row),
        escapeCsv(b.date),
        escapeCsv(b.vendor),
        escapeCsv(b.invoice),
        escapeCsv(b.cond || 'Good'),
        escapeCsv(b.status || 'Available'),
        escapeCsv(b.notes),
      ];
      res.write(row.join(',') + '\n');
    });

    res.end();
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/import-export/excel
 * Generates and downloads native Microsoft Excel (.xlsx) file
 */
exports.exportExcel = async (_req, res, next) => {
  try {
    await syncInventoryToExcel();

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      return res.status(500).json({ success: false, message: 'Excel file generation failed' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="crescent_library_inventory.xlsx"');

    const fileStream = fs.createReadStream(EXCEL_FILE_PATH);
    fileStream.pipe(res);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/import-export/template
 */
exports.getTemplate = (_req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="clms_book_import_template.csv"');

  const sample = [
    'Introduction to Algorithms',
    'ACC-0001',
    '9780262046305',
    'Cormen, Leiserson, Rivest, Stein',
    '',
    'MIT Press',
    '3rd Edition',
    '2022',
    'Computer Science',
    'English',
    'Hardcover',
    '1250',
    '3',
    'A-1',
    'Row 1',
    '2024-01-15',
    'Pearson India',
    'INV-2024-001',
    'New',
    'Available',
    'Standard curriculum text',
  ];

  res.write(CSV_COLUMNS.join(',') + '\n');
  res.write(sample.map(escapeCsv).join(',') + '\n');
  res.end();
};

/**
 * POST /api/v1/import-export/preview
 */
exports.previewImport = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Please upload a CSV file.' });
    }

    const rows = parseCsvBuffer(req.file.buffer);
    const existingAccs = new Set(await Book.distinct('acc'));

    const preview = [];
    const errors = [];

    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      const title = r.title || r['book title'] || '';
      const acc = (r.acc || r.acc_no || r['accession number'] || '').toUpperCase();

      let err = '';
      if (!title) err = 'Missing title';
      else if (!acc) err = 'Missing accession number';
      else if (existingAccs.has(acc)) err = `Duplicate accession number "${acc}"`;

      if (err) errors.push(`Row ${rowNum}: ${err}`);

      preview.push({
        row: rowNum,
        title,
        acc,
        author: r.author || '',
        cat: r.cat || r.category || '',
        copies: parseInt(r.copies, 10) || 1,
        status: r.status || 'Available',
        issue: err,
      });
    });

    res.json({
      success: true,
      total_rows: rows.length,
      valid_rows: preview.filter((p) => !p.issue).length,
      errors_count: errors.length,
      errors,
      preview: preview.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/import-export/import
 */
exports.importCsv = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Please upload a CSV file.' });
    }

    const rows = parseCsvBuffer(req.file.buffer);
    const existingAccs = new Set(await Book.distinct('acc'));
    const categoriesSet = new Set(await Category.distinct('name'));

    let imported = 0;
    let skipped = 0;
    const errors = [];
    const booksToInsert = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const title = (r.title || r['book title'] || '').trim();
      let acc = (r.acc || r.acc_no || '').trim().toUpperCase();

      if (!title) {
        errors.push(`Row ${rowNum}: Skipped (missing title)`);
        skipped++;
        continue;
      }

      if (!acc) {
        const nextNum = existingAccs.size + 1;
        acc = `ACC-${String(nextNum).padStart(4, '0')}`;
      }

      if (existingAccs.has(acc)) {
        errors.push(`Row ${rowNum}: Skipped (duplicate accession "${acc}")`);
        skipped++;
        continue;
      }

      const catName = (r.cat || r.category || '').trim();
      if (catName && !categoriesSet.has(catName)) {
        try {
          await Category.create({ name: catName, createdBy: req.user?._id });
          categoriesSet.add(catName);
        } catch (e) {}
      }

      booksToInsert.push({
        title,
        acc,
        isbn: (r.isbn || '').trim() || undefined,
        author: (r.author || '').trim() || undefined,
        addl: (r.addl || r.addl_authors || '').trim() || undefined,
        publisher: (r.publisher || '').trim() || undefined,
        edition: (r.edition || '').trim() || undefined,
        year: parseInt(r.year, 10) || undefined,
        lang: (r.lang || r.language || 'English').trim(),
        format: (r.format || 'Hardcover').trim(),
        cat: catName || undefined,
        price: parseFloat(r.price) || 0,
        copies: Math.max(1, parseInt(r.copies, 10) || 1),
        shelf: (r.shelf || '').trim() || undefined,
        row: (r.row || r.rack_row || '').trim() || undefined,
        date: (r.date || r.date_acquired || '').trim() || undefined,
        vendor: (r.vendor || '').trim() || undefined,
        invoice: (r.invoice || r.invoice_no || '').trim() || undefined,
        cond: (r.cond || r.condition || 'Good').trim(),
        status: (r.status || 'Available').trim(),
        notes: (r.notes || '').trim() || undefined,
        createdBy: req.user?._id,
        updatedBy: req.user?._id,
      });

      existingAccs.add(acc);
      imported++;
    }

    if (booksToInsert.length > 0) {
      await Book.insertMany(booksToInsert, { ordered: false });
      await syncInventoryToExcel();
    }

    res.json({
      success: true,
      message: `Imported ${imported} books successfully (${skipped} skipped).`,
      imported,
      skipped,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    next(err);
  }
};
