const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    createReport,
    getReports,
    autoPopulate,
    getReportById,
    updateReport,
    submitReport,
    reviewReport
} = require('./reports.controller');

// Create a new report
router.post('/',
    authenticateToken,
    authorize('LAB_TECH'),
    asyncHandler(createReport)
);

// List reports (role-based)
router.get('/',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD'),
    asyncHandler(getReports)
);

// Auto-populate report from tickets
router.get('/auto-populate',
    authenticateToken,
    authorize('LAB_TECH'),
    asyncHandler(autoPopulate)
);

// Get a single report
router.get('/:id',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD'),
    asyncHandler(getReportById)
);

// Update own draft report
router.put('/:id',
    authenticateToken,
    authorize('LAB_TECH'),
    asyncHandler(updateReport)
);

// Submit a draft report
router.patch('/:id/submit',
    authenticateToken,
    authorize('LAB_TECH'),
    asyncHandler(submitReport)
);

// Review a submitted report (Lab Head)
router.patch('/:id/review',
    authenticateToken,
    authorize('LAB_HEAD'),
    asyncHandler(reviewReport)
);

module.exports = router;
