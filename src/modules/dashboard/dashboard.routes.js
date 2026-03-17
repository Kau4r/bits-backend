const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { getDashboardMetrics } = require('./dashboard.controller');

// GET /api/dashboard
router.get('/', authenticateToken, getDashboardMetrics);

module.exports = router;
