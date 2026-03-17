const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNotificationById
} = require('./notifications.controller');

// Get user's notifications
router.get('/', authenticateToken, asyncHandler(getNotifications));

// Get unread notification count
router.get('/unread-count', authenticateToken, asyncHandler(getUnreadCount));

// Mark notification as read
router.patch('/:id/read', authenticateToken, asyncHandler(markAsRead));

// Mark all notifications as read
router.post('/mark-all-read', authenticateToken, asyncHandler(markAllAsRead));

// Get notification by ID
router.get('/:id', authenticateToken, asyncHandler(getNotificationById));

module.exports = router;
