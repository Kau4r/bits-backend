const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  archiveNotification,
  restoreNotification,
  getNotificationById
} = require('./notifications.controller');

// Get user's notifications
router.get('/', authenticateToken, asyncHandler(getNotifications));

// Get unread notification count
router.get('/unread-count', authenticateToken, asyncHandler(getUnreadCount));

// Mark notification as read
router.patch('/:id/read', authenticateToken, asyncHandler(markAsRead));

// Mark notification as unread (flip back for follow-up)
router.patch('/:id/unread', authenticateToken, asyncHandler(markAsUnread));

// Mark all notifications as read
router.post('/mark-all-read', authenticateToken, asyncHandler(markAllAsRead));
router.patch('/read-all', authenticateToken, asyncHandler(markAllAsRead));

// Archive / restore notification
router.patch('/:id/archive', authenticateToken, asyncHandler(archiveNotification));
router.patch('/:id/restore', authenticateToken, asyncHandler(restoreNotification));

// Get notification by ID
router.get('/:id', authenticateToken, asyncHandler(getNotificationById));

module.exports = router;
