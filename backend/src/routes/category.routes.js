'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/category.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', ctrl.getCategories);
router.get('/:id', ctrl.getCategory);
router.post('/', ctrl.createCategory);
router.patch('/:id', ctrl.updateCategory);
router.delete('/:id', ctrl.deleteCategory);

module.exports = router;
