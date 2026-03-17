const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getItems,
  getAvailableItems,
  getItemByCode,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  bulkCreateItems
} = require('./inventory.controller');

// Get all items
router.get('/', asyncHandler(getItems));

// Get available items by type (for computer assembly)
router.get('/available', asyncHandler(getAvailableItems));

// Get item by code
router.get('/code/:itemCode', asyncHandler(getItemByCode));

// Get item by ID
router.get('/:id', asyncHandler(getItemById));

// Create new item
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(createItem));

// Update item
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(updateItem));

// Delete item (soft delete)
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(deleteItem));

// Bulk create inventory items
router.post('/bulk', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(bulkCreateItems));

module.exports = router;
