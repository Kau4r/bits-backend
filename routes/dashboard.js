const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../src/middleware/auth');
const { getDashboardMetrics } = require('../src/controllers/dashboardController');

// GET /api/dashboard
router.get('/', authenticateToken, getDashboardMetrics);

module.exports = router;
