const express = require('express');
const multer = require('multer');
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
  bulkCreateItems,
  importInventoryCsv,
  checkInventoryItem,
  uncheckInventoryItem,
} = require('./inventory.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const lowerName = file.originalname.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx')) {
      return cb(new Error('Only .csv and .xlsx files are supported'));
    }
    return cb(null, true);
  }
});

const uploadCsv = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message || 'Invalid inventory import upload' });
    }
    return next();
  });
};

// Get all items
router.get('/', asyncHandler(getItems));

// Get available items by type (for computer assembly)
router.get('/available', asyncHandler(getAvailableItems));

// Get item by code
router.get('/code/:itemCode', authenticateToken, authorize('LAB_HEAD', 'LAB_TECH'), asyncHandler(getItemByCode));

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

// Import inventory items from CSV/XLSX
router.post('/import-csv', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), uploadCsv, asyncHandler(importInventoryCsv));

// Mark an item as audited (present) for the current semester
router.post('/:id/check', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(checkInventoryItem));
router.delete('/:id/check', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(uncheckInventoryItem));

module.exports = router;
