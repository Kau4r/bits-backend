const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const { getDashboardMetrics, getLabTechLeaderboard } = require('./dashboard.controller');

// GET /api/dashboard
router.get('/', authenticateToken, asyncHandler(getDashboardMetrics));

// GET /api/dashboard/leaderboard — volume leaderboard of requests handled per lab tech
router.get(
    '/leaderboard',
    authenticateToken,
    authorize('LAB_HEAD', 'ADMIN'),
    asyncHandler(getLabTechLeaderboard)
);

module.exports = router;
