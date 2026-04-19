const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const { getCleanupPreview, runCleanup } = require('./maintenance.controller');

router.get('/cleanup-preview', authenticateToken, authorize('ADMIN'), asyncHandler(getCleanupPreview));
router.post('/cleanup', authenticateToken, authorize('ADMIN'), asyncHandler(runCleanup));

module.exports = router;
