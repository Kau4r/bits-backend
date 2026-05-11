const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const { validate, inventorySchemas } = require('../../middleware/validate');
const {
  getItems,
  getAvailableItems,
  getItemTypes,
  getItemByCode,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  bulkCreateItems,
  importInventoryCsv,
  checkInventoryItem,
  uncheckInventoryItem,
  getItemHistory,
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
router.get('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'SECRETARY'), asyncHandler(getItems));

// Get available items by type (for computer assembly)
router.get('/available', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'SECRETARY'), asyncHandler(getAvailableItems));

// Get distinct item types currently present in inventory (for dynamic component pickers)
router.get('/item-types', authenticateToken, asyncHandler(getItemTypes));

// Get item by code
router.get('/code/:itemCode', authenticateToken, authorize('LAB_HEAD', 'LAB_TECH'), asyncHandler(getItemByCode));

// Get item by ID
router.get('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'SECRETARY'), asyncHandler(getItemById));

// Create new item
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), validate(inventorySchemas.create), asyncHandler(createItem));

// Update item
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), validate(inventorySchemas.update), asyncHandler(updateItem));

// Delete item (soft delete)
router.delete('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(deleteItem));

// Bulk create inventory items
router.post('/bulk', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(bulkCreateItems));

// Import inventory items from CSV/XLSX
router.post('/import-csv', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), uploadCsv, asyncHandler(importInventoryCsv));

// Mark an item as audited (present) for the current semester
router.post('/:id/check', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(checkInventoryItem));
router.delete('/:id/check', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(uncheckInventoryItem));

// Audit trail / history for a single item
router.get('/:id/history', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(getItemHistory));

module.exports = router;
