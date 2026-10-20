'use strict';
const Book = require('../models/Book');
const Category = require('../models/Category');

/**
 * GET /api/v1/reports/summary
 */
exports.getSummary = async (_req, res, next) => {
  try {
    const [totalBooks, totalCategories, agg] = await Promise.all([
      Book.countDocuments(),
      Category.countDocuments(),
      Book.aggregate([
        {
          $group: {
            _id: null,
            totalCopies: { $sum: '$copies' },
            totalValue: { $sum: { $multiply: ['$price', '$copies'] } },
            availableBooks: {
              $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'available'] }, 1, 0] },
            },
            issuedBooks: {
              $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'issued'] }, 1, 0] },
            },
            reservedBooks: {
              $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'reserved'] }, 1, 0] },
            },
            lostBooks: {
              $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'lost'] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const stats = agg[0] || {};
    const totalCopies = stats.totalCopies || 0;
    const totalValue = Math.round((stats.totalValue || 0) * 100) / 100;

    const data = {
      total_books: totalBooks,
      totalBooks,
      total_copies: totalCopies,
      totalCopies,
      total_categories: totalCategories,
      totalCategories,
      total_inventory_value: totalValue,
      totalValue,
      available_books: stats.availableBooks || 0,
      issued_books: stats.issuedBooks || 0,
      reserved_books: stats.reservedBooks || 0,
      lost_books: stats.lostBooks || 0,
    };

    res.json({ success: true, ...data, data });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/reports/full
 */
exports.getFullReport = async (_req, res, next) => {
  try {
    const [totalBooks, totalCategories, aggSummary, byCat, byStat, byYr, bySh] = await Promise.all([
      Book.countDocuments(),
      Category.countDocuments(),
      Book.aggregate([
        {
          $group: {
            _id: null,
            totalCopies: { $sum: '$copies' },
            totalValue: { $sum: { $multiply: ['$price', '$copies'] } },
          },
        },
      ]),
      Book.aggregate([
        { $group: { _id: { $ifNull: ['$cat', 'Uncategorized'] }, count: { $sum: 1 }, copies: { $sum: '$copies' } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, category: '$_id', count: 1, copies: 1 } },
      ]),
      Book.aggregate([
        { $group: { _id: { $ifNull: ['$status', 'Available'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
      ]),
      Book.aggregate([
        { $match: { year: { $exists: true, $ne: null, $gt: 0 } } },
        { $group: { _id: '$year', count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: 15 },
        { $project: { _id: 0, year: '$_id', count: 1 } },
      ]),
      Book.aggregate([
        {
          $group: {
            _id: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$shelf', null] },
                    { $eq: ['$shelf', ''] },
                    { $not: ['$shelf'] },
                  ],
                },
                'Unassigned',
                '$shelf',
              ],
            },
            count: { $sum: 1 },
            copies: { $sum: '$copies' },
          },
        },
        { $sort: { copies: -1 } },
        { $limit: 15 },
        { $project: { _id: 0, shelf: '$_id', count: 1, copies: 1 } },
      ]),
    ]);

    const stats = aggSummary[0] || {};
    const summary = {
      total_books: totalBooks,
      totalBooks,
      total_copies: stats.totalCopies || 0,
      totalCopies: stats.totalCopies || 0,
      total_categories: totalCategories,
      totalCategories,
      total_inventory_value: Math.round((stats.totalValue || 0) * 100) / 100,
      totalValue: Math.round((stats.totalValue || 0) * 100) / 100,
    };

    const data = {
      summary,
      by_category: byCat,
      byCategory: byCat,
      by_status: byStat,
      byStatus: byStat,
      by_year: byYr,
      byYear: byYr,
      by_shelf: bySh,
      byShelf: bySh,
    };

    res.json({ success: true, ...data, data });
  } catch (err) {
    next(err);
  }
};
