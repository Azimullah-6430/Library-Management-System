'use strict';
const Category = require('../models/Category');
const Book = require('../models/Book');

/**
 * GET /api/v1/categories
 */
exports.getCategories = async (_req, res, next) => {
  try {
    const categories = await Category.find().sort({ name: 1 }).lean();

    // Compute live book count for each category
    const counts = await Book.aggregate([
      { $group: { _id: '$cat', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => {
      if (c._id) countMap[c._id.toLowerCase()] = c.count;
    });

    const data = categories.map((c) => ({
      ...c,
      id: c._id.toString(),
      description: c.desc,
      book_count: countMap[c.name.toLowerCase()] || 0,
      bookCount: countMap[c.name.toLowerCase()] || 0,
    }));

    res.json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/categories/:id
 */
exports.getCategory = async (req, res, next) => {
  try {
    const cat = await Category.findById(req.params.id).lean();
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

    const count = await Book.countDocuments({ cat: cat.name });
    const data = {
      ...cat,
      id: cat._id.toString(),
      description: cat.desc,
      book_count: count,
      bookCount: count,
    };

    res.json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/categories
 */
exports.createCategory = async (req, res, next) => {
  try {
    const { name, desc, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ success: false, message: `Category "${name.trim()}" already exists` });
    }

    const cat = await Category.create({
      name: name.trim(),
      desc: (desc || description || '').trim(),
      createdBy: req.user?._id,
    });

    const data = {
      ...cat.toObject(),
      id: cat._id.toString(),
      description: cat.desc,
      book_count: 0,
      bookCount: 0,
    };

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/categories/:id
 */
exports.updateCategory = async (req, res, next) => {
  try {
    const { name, desc, description } = req.body;
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

    const oldName = cat.name;

    if (name && name.trim().toLowerCase() !== oldName.toLowerCase()) {
      const existing = await Category.findOne({
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        _id: { $ne: req.params.id },
      });
      if (existing) {
        return res.status(400).json({ success: false, message: `Category "${name.trim()}" already exists` });
      }

      cat.name = name.trim();
      // Cascade update books with the old category name
      await Book.updateMany({ cat: oldName }, { cat: name.trim() });
    }

    if (desc !== undefined || description !== undefined) {
      cat.desc = (desc || description || '').trim();
    }

    await cat.save();

    const count = await Book.countDocuments({ cat: cat.name });
    const data = {
      ...cat.toObject(),
      id: cat._id.toString(),
      description: cat.desc,
      book_count: count,
      bookCount: count,
    };

    res.json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/categories/:id
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });

    // Books in this category become unassigned
    await Book.updateMany({ cat: cat.name }, { cat: '' });

    await Category.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: `Category "${cat.name}" deleted.` });
  } catch (err) {
    next(err);
  }
};
