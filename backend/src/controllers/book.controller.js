const path = require('path');
const fs = require('fs');
const Book = require('../models/Book');
const { deleteFile } = require('../middleware/upload');
const { syncInventoryToExcel } = require('../utils/excelSync');
const { extractBookMetadata } = require('../utils/universalBookExtractor');

const toFullUrl = (req, p) => {
  if (!p) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
};

const extractCoverPaths = (req) => {
  const result = {};
  const front = req.files?.frontCover?.[0] || req.files?.front?.[0];
  const back = req.files?.backCover?.[0] || req.files?.back?.[0];
  if (front) result.frontCover = `/uploads/${front.filename}`;
  if (back) result.backCover = `/uploads/${back.filename}`;
  return result;
};

/**
 * GET /api/v1/books
 */
exports.getBooks = async (req, res, next) => {
  try {
    const {
      q = '',
      cat = '',
      category = '',
      status = '',
      shelf = '',
      sort = 'createdAt',
      dir = '-1',
      page = '1',
      pg = '1',
      limit = '15',
      page_size = '15',
      all = 'false',
    } = req.query;

    const filter = {};

    // Search query
    if (q.trim()) {
      const term = q.trim();
      filter.$or = [
        { title: { $regex: term, $options: 'i' } },
        { author: { $regex: term, $options: 'i' } },
        { acc: { $regex: term, $options: 'i' } },
        { isbn: { $regex: term, $options: 'i' } },
        { publisher: { $regex: term, $options: 'i' } },
      ];
    }

    const catFilter = cat || category;
    if (catFilter) filter.cat = { $regex: new RegExp(`^${catFilter.trim()}$`, 'i') };

    if (status) filter.status = status;
    if (shelf) filter.shelf = { $regex: shelf.trim(), $options: 'i' };

    const sortFieldMap = {
      title: 'title',
      acc: 'acc',
      acc_no: 'acc',
      author: 'author',
      price: 'price',
      copies: 'copies',
      year: 'year',
      created_at: 'createdAt',
      createdAt: 'createdAt',
    };
    const sortField = sortFieldMap[sort] || 'createdAt';
    const sortDir = dir === '1' ? 1 : -1;

    const pageNum = Math.max(1, parseInt(pg || page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(page_size || limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [total, books] = await Promise.all([
      Book.countDocuments(filter),
      all === 'true'
        ? Book.find(filter).sort({ [sortField]: sortDir }).lean()
        : Book.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limitNum).lean(),
    ]);

    const formatted = books.map((b) => ({
      ...b,
      id: b._id.toString(),
      acc_no: b.acc,
      category: b.cat,
      addl_authors: b.addl,
      rack_row: b.row,
      date_acquired: b.date,
      invoice_no: b.invoice,
      condition: b.cond,
      front: toFullUrl(req, b.frontCover),
      back: toFullUrl(req, b.backCover),
      frontCover: toFullUrl(req, b.frontCover),
      backCover: toFullUrl(req, b.backCover),
    }));

    const totalPages = Math.max(1, Math.ceil(total / limitNum));

    res.json({
      success: true,
      total,
      page: pageNum,
      pages: totalPages,
      total_pages: totalPages,
      limit: limitNum,
      page_size: limitNum,
      items: formatted,
      data: formatted,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/books/:id
 */
exports.getBook = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id).lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

    const formatted = {
      ...book,
      id: book._id.toString(),
      acc_no: book.acc,
      category: book.cat,
      addl_authors: book.addl,
      rack_row: book.row,
      date_acquired: book.date,
      invoice_no: book.invoice,
      condition: book.cond,
      front: toFullUrl(req, book.frontCover),
      back: toFullUrl(req, book.backCover),
      frontCover: toFullUrl(req, book.frontCover),
      backCover: toFullUrl(req, book.backCover),
    };

    res.json({ success: true, ...formatted, data: formatted });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/books
 */
exports.createBook = async (req, res, next) => {
  try {
    const covers = extractCoverPaths(req);
    const body = { ...req.body, ...covers };

    // Resolve shorthand aliases
    if (body.acc_no && !body.acc) body.acc = body.acc_no;
    if (body.category && !body.cat) body.cat = body.category;
    if (body.addl_authors && !body.addl) body.addl = body.addl_authors;
    if (body.rack_row && !body.row) body.row = body.rack_row;
    if (body.date_acquired && !body.date) body.date = body.date_acquired;
    if (body.invoice_no && !body.invoice) body.invoice = body.invoice_no;
    if (body.condition && !body.cond) body.cond = body.condition;

    // Auto-generate accession number if missing
    if (!body.acc) {
      const count = await Book.countDocuments();
      body.acc = `ACC-${String(count + 1).padStart(4, '0')}`;
    }

    if (body.price !== undefined) body.price = parseFloat(body.price) || 0;
    if (body.copies !== undefined) body.copies = Math.max(1, parseInt(body.copies, 10) || 1);
    if (body.year !== undefined && body.year !== '') body.year = parseInt(body.year, 10) || undefined;

    body.createdBy = req.user?._id;
    body.updatedBy = req.user?._id;

    const book = await Book.create(body);
    const obj = book.toObject();

    const formatted = {
      ...obj,
      id: obj._id.toString(),
      acc_no: obj.acc,
      category: obj.cat,
      frontCover: toFullUrl(req, obj.frontCover),
      backCover: toFullUrl(req, obj.backCover),
      front: toFullUrl(req, obj.frontCover),
      back: toFullUrl(req, obj.backCover),
    };

    await syncInventoryToExcel();

    res.status(201).json({
      success: true,
      message: 'Book saved to catalog and automatically stored in Excel.',
      excel_synced: true,
      ...formatted,
      data: formatted,
    });
  } catch (err) {
    if (req.files?.frontCover?.[0]) deleteFile(req.files.frontCover[0].filename);
    if (req.files?.backCover?.[0]) deleteFile(req.files.backCover[0].filename);
    next(err);
  }
};

/**
 * PATCH /api/v1/books/:id
 */
exports.updateBook = async (req, res, next) => {
  try {
    const existing = await Book.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Book not found' });

    const covers = extractCoverPaths(req);
    const body = { ...req.body, ...covers };

    if (body.acc_no && !body.acc) body.acc = body.acc_no;
    if (body.category && !body.cat) body.cat = body.category;
    if (body.addl_authors && !body.addl) body.addl = body.addl_authors;
    if (body.rack_row && !body.row) body.row = body.rack_row;
    if (body.date_acquired && !body.date) body.date = body.date_acquired;
    if (body.invoice_no && !body.invoice) body.invoice = body.invoice_no;
    if (body.condition && !body.cond) body.cond = body.condition;

    if (body.price !== undefined) body.price = parseFloat(body.price) || 0;
    if (body.copies !== undefined) body.copies = Math.max(1, parseInt(body.copies, 10) || 1);
    if (body.year !== undefined && body.year !== '') body.year = parseInt(body.year, 10) || undefined;

    body.updatedBy = req.user?._id;

    // Delete old covers if new ones uploaded
    if (covers.frontCover && existing.frontCover) deleteFile(existing.frontCover);
    if (covers.backCover && existing.backCover) deleteFile(existing.backCover);

    const updated = await Book.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    }).lean();

    const formatted = {
      ...updated,
      id: updated._id.toString(),
      acc_no: updated.acc,
      category: updated.cat,
      frontCover: toFullUrl(req, updated.frontCover),
      backCover: toFullUrl(req, updated.backCover),
      front: toFullUrl(req, updated.frontCover),
      back: toFullUrl(req, updated.backCover),
    };

    await syncInventoryToExcel();

    res.json({
      success: true,
      message: 'Book updated successfully and synced to Excel.',
      excel_synced: true,
      ...formatted,
      data: formatted,
    });
  } catch (err) {
    if (req.files?.frontCover?.[0]) deleteFile(req.files.frontCover[0].filename);
    if (req.files?.backCover?.[0]) deleteFile(req.files.backCover[0].filename);
    next(err);
  }
};

/**
 * POST /api/v1/books/:id/covers
 */
exports.uploadBookCovers = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

    const covers = extractCoverPaths(req);
    if (covers.frontCover) {
      if (book.frontCover) deleteFile(book.frontCover);
      book.frontCover = covers.frontCover;
    }
    if (covers.backCover) {
      if (book.backCover) deleteFile(book.backCover);
      book.backCover = covers.backCover;
    }

    book.updatedBy = req.user?._id;
    await book.save({ validateBeforeSave: false });

    const formatted = {
      ...book.toObject(),
      id: book._id.toString(),
      frontCover: toFullUrl(req, book.frontCover),
      backCover: toFullUrl(req, book.backCover),
      front: toFullUrl(req, book.frontCover),
      back: toFullUrl(req, book.backCover),
    };

    res.json({ success: true, message: 'Covers uploaded.', ...formatted, data: formatted });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/books/:id
 */
exports.deleteBook = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

    if (book.frontCover) deleteFile(book.frontCover);
    if (book.backCover) deleteFile(book.backCover);

    await Book.findByIdAndDelete(req.params.id);

    await syncInventoryToExcel();

    res.json({ success: true, message: `Book "${book.title}" was deleted from catalog and Excel file synced.` });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/books/extract-details
 * Extracts 100% accurate, dynamic details from front and back book covers
 */
exports.extractBookDetailsFromCovers = async (req, res, next) => {
  try {
    const front = req.files?.frontCover?.[0] || req.files?.front?.[0];
    const back = req.files?.backCover?.[0] || req.files?.back?.[0];

    let frontPath = front?.path || '';
    let backPath = back?.path || '';

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    // Handle base64 covers if provided in JSON/multipart body
    if (!frontPath && req.body.frontBase64) {
      const b64 = req.body.frontBase64.replace(/^data:image\/\w+;base64,/, '');
      const tempP = path.join(uploadsDir, `extract-front-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`);
      fs.writeFileSync(tempP, Buffer.from(b64, 'base64'));
      frontPath = tempP;
    }
    if (!backPath && req.body.backBase64) {
      const b64 = req.body.backBase64.replace(/^data:image\/\w+;base64,/, '');
      const tempP = path.join(uploadsDir, `extract-back-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`);
      fs.writeFileSync(tempP, Buffer.from(b64, 'base64'));
      backPath = tempP;
    }

    if (!frontPath && !backPath) {
      return res.status(400).json({
        success: false,
        message: 'Please provide front and/or back book cover images to extract details.',
      });
    }

    const metadata = await extractBookMetadata(frontPath, backPath);

    res.json({
      success: true,
      message: 'Book details extracted successfully.',
      data: metadata,
      frontCoverUrl: front ? toFullUrl(req, `/uploads/${front.filename}`) : '',
      backCoverUrl: back ? toFullUrl(req, `/uploads/${back.filename}`) : '',
    });
  } catch (err) {
    console.error('Error in extractBookDetailsFromCovers:', err);
    res.status(500).json({ success: false, message: 'Failed to extract book details: ' + err.message });
  }
};

