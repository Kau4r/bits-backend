const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getCleanupPreview,
    getSchoolYearArchivePreview,
    runCleanup,
    runSchoolYearArchiveCleanup,
    downloadArchive,
    listArchiveFiles,
    listMaintenanceHistory
} = require('./maintenance.controller');

router.get('/cleanup-preview', authenticateToken, authorize('ADMIN'), asyncHandler(getCleanupPreview));
router.get('/school-year-archive-preview', authenticateToken, authorize('ADMIN'), asyncHandler(getSchoolYearArchivePreview));
router.get('/archives', authenticateToken, authorize('ADMIN'), asyncHandler(listArchiveFiles));
router.get('/archives/:fileName', authenticateToken, authorize('ADMIN'), asyncHandler(downloadArchive));
router.get('/history', authenticateToken, authorize('ADMIN'), asyncHandler(listMaintenanceHistory));
router.post('/cleanup', authenticateToken, authorize('ADMIN'), asyncHandler(runCleanup));
router.post('/school-year-archive-cleanup', authenticateToken, authorize('ADMIN'), asyncHandler(runSchoolYearArchiveCleanup));

module.exports = router;
