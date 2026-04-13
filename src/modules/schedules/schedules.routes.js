const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
  importOfferedCourseSchedules,
  previewOfferedCourseImport
} = require('./schedules.controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      return cb(new Error('Only .xlsx files are supported'));
    }

    return cb(null, true);
  }
});

const uploadWorkbook = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message || 'Invalid workbook upload' });
    }

    return next();
  });
};

router.post(
  '/import-offered-courses/preview',
  authenticateToken,
  authorize('ADMIN'),
  uploadWorkbook,
  asyncHandler(previewOfferedCourseImport)
);

router.post(
  '/import-offered-courses',
  authenticateToken,
  authorize('ADMIN'),
  uploadWorkbook,
  asyncHandler(importOfferedCourseSchedules)
);

module.exports = router;
