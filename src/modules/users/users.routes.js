const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getCurrentUser,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserHistory,
  bulkCreateUsers
} = require('./users.controller');

// Get current authenticated user
router.get('/me', authenticateToken, asyncHandler(getCurrentUser));

// Get all users (with optional filters: active, role)
router.get('/', authenticateToken, asyncHandler(getUsers));

// Create new user
router.post('/', authenticateToken, authorize('ADMIN'), asyncHandler(createUser));

// Update user (simple, no versioning)
router.put('/:id', authenticateToken, authorize('ADMIN'), asyncHandler(updateUser));

// Soft delete user (mark as inactive)
router.delete('/:id', authenticateToken, authorize('ADMIN'), asyncHandler(deleteUser));

// Get user history (from audit log)
router.get('/:id/history', authenticateToken, asyncHandler(getUserHistory));

// Bulk create users
router.post('/bulk', authenticateToken, authorize('ADMIN'), asyncHandler(bulkCreateUsers));

module.exports = router;
