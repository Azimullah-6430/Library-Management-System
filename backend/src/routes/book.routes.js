'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/book.controller');
const { protect } = require('../middleware/auth');
const { uploadCovers } = require('../middleware/upload');

// Cover OCR extraction (available for librarian add-book workflow)
router.post('/extract-details', uploadCovers, ctrl.extractBookDetailsFromCovers);

// Protected routes
router.use(protect);

router.get('/', ctrl.getBooks);
router.get('/:id', ctrl.getBook);
router.post('/', uploadCovers, ctrl.createBook);
router.patch('/:id', uploadCovers, ctrl.updateBook);
router.post('/:id/covers', uploadCovers, ctrl.uploadBookCovers);
router.delete('/:id', ctrl.deleteBook);

module.exports = router;
