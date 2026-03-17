const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    getBorrowings,
    createBorrowing,
    approveBorrowing,
    rejectBorrowing,
    returnBorrowing,
    getPendingCount
} = require('./borrowing.controller');

// List borrowing requests
router.get('/', authenticateToken, asyncHandler(getBorrowings));

// Request to borrow items
router.post('/', authenticateToken, asyncHandler(createBorrowing));

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
router.patch('/:id/return', authenticateToken, asyncHandler(returnBorrowing));

// Get count of pending requests
router.get('/pending/count',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(getPendingCount)
);

module.exports = router;
