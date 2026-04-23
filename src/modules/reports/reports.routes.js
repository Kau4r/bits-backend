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
    reviewReport,
    deleteReport,
    getDashboardReportSummary,
    exportDashboardSummaryCsv,
    exportInventoryCsv,
    exportRoomsCsv,
    exportWeeklyReportsCsv
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

// Dashboard report summary
router.get('/summary',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(getDashboardReportSummary)
);

// Dashboard report summary export
router.get('/summary.csv',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(exportDashboardSummaryCsv)
);

// Inventory report export
router.get('/inventory.csv',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(exportInventoryCsv)
);

// Room report export
router.get('/rooms.csv',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(exportRoomsCsv)
);

// Weekly reports export
router.get('/weekly.csv',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(exportWeeklyReportsCsv)
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

// Delete own DRAFT report
router.delete('/:id',
    authenticateToken,
    authorize('LAB_TECH'),
    asyncHandler(deleteReport)
);

module.exports = router;
