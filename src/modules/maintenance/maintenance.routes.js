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
    downloadArchive
} = require('./maintenance.controller');

router.get('/cleanup-preview', authenticateToken, authorize('ADMIN'), asyncHandler(getCleanupPreview));
router.get('/school-year-archive-preview', authenticateToken, authorize('ADMIN'), asyncHandler(getSchoolYearArchivePreview));
router.get('/archives/:fileName', authenticateToken, authorize('ADMIN'), asyncHandler(downloadArchive));
router.post('/cleanup', authenticateToken, authorize('ADMIN'), asyncHandler(runCleanup));
router.post('/school-year-archive-cleanup', authenticateToken, authorize('ADMIN'), asyncHandler(runSchoolYearArchiveCleanup));

module.exports = router;
