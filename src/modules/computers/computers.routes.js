const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getComputers,
    createComputer,
    updateComputer,
    deleteComputer,
    importComputersCsv
} = require('./computers.controller');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const lowerName = file.originalname.toLowerCase();
        if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx')) {
            return cb(new Error('Only .csv and .xlsx files are supported'));
        }
        return cb(null, true);
    }
});

const uploadCsv = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (error) {
            return res.status(400).json({ success: false, error: error.message || 'Invalid import file upload' });
        }
        return next();
    });
};

router.get('/', authenticateToken, asyncHandler(getComputers));
router.post('/import-csv', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), uploadCsv, asyncHandler(importComputersCsv));
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(createComputer));
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(updateComputer));
router.delete('/:id', authenticateToken, authorize('LAB_HEAD', 'LAB_TECH'), asyncHandler(deleteComputer));

module.exports = router;
