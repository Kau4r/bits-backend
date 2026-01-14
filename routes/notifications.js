const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NotificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');

// Get user's notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { cursor, limit = 20, unreadOnly } = req.query;
    const { notifications, nextCursor } = await NotificationService.getUserNotifications(
      req.user.User_ID,
      {
        limit: parseInt(limit),
        cursor: cursor ? parseInt(cursor) : null,
        unreadOnly: unreadOnly === 'true',
      }
    );

    res.json({
      success: true,
      data: notifications,
      nextCursor,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message,
    });
  }
});

// Get unread notification count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user.User_ID);
    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
      error: error.message,
    });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await NotificationService.markAsRead(parseInt(id), req.user.User_ID);

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or already read',
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message,
    });
  }
});

// Mark all notifications as read
router.post('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    await NotificationService.markAllAsRead(req.user.User_ID);
    res.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error.message,
    });
  }
});

// Get notification by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await prisma.audit_Log.findFirst({
      where: {
        Log_ID: parseInt(id),
        Is_Notification: true,
        OR: [
          { User_ID: req.user.User_ID },
          { User_ID: null },
        ],
      },
      include: {
        User: {
          select: { First_Name: true, Last_Name: true, Email: true, User_Role: true },
        },
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    // Mark as read when fetched
    if (!notification.Notification_Read_At) {
      await NotificationService.markAsRead(notification.Log_ID, req.user.User_ID);
      notification.Notification_Read_At = new Date();
    }

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error('Error fetching notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification',
      error: error.message,
    });
  }
});

module.exports = router;
