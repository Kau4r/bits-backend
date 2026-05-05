const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const { getDashboardMetrics } = require('./dashboard.controller');

// GET /api/dashboard
router.get('/', authenticateToken, asyncHandler(getDashboardMetrics));

module.exports = router;
