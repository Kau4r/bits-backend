const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { borrowingSchemas } = require('./borrowing.validation');
const {
    getBorrowings,
    createBorrowing,
    createWalkinBorrowing,
    approveBorrowing,
    rejectBorrowing,
    returnBorrowing,
    getPendingCount
} = require('./borrowing.controller');

// List borrowing requests
router.get('/', authenticateToken, asyncHandler(getBorrowings));

// Request to borrow items
router.post('/', authenticateToken, validate(borrowingSchemas.create), asyncHandler(createBorrowing));

// Lab Tech walk-in: create a BORROWED record directly
router.post('/walkin',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    validate(borrowingSchemas.walkin),
    asyncHandler(createWalkinBorrowing)
);

// Approve a borrow request
router.patch('/:id/approve',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(approveBorrowing)
);

// Reject a borrow request
router.patch('/:id/reject',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(rejectBorrowing)
);

// Return a borrowed item
router.patch('/:id/return', authenticateToken, authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'), asyncHandler(returnBorrowing));

// Get count of pending requests
router.get('/pending/count',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(getPendingCount)
);

module.exports = router;
