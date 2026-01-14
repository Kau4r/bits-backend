const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
<<<<<<< HEAD
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
    const notification = await prisma.notification.findFirst({
      where: {
        id: parseInt(id),
        OR: [
          { recipientId: req.user.User_ID },
          { recipientId: null }, // Broadcast notifications
        ],
      },
      include: {
        sender: {
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
    if (!notification.isRead) {
      await NotificationService.markAsRead(notification.id, req.user.User_ID);
      notification.isRead = true;
      notification.readAt = new Date();
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
=======

// GET /api/notifications - Get notifications (audit logs marked as notifications)
router.get('/', async (req, res) => {
    try {
        const { limit = 20, unreadOnly } = req.query;

        const where = {
            Is_Notification: true,
        };

        if (unreadOnly === 'true') {
            where.Notification_Read_At = null;
        }

        const notifications = await prisma.audit_Log.findMany({
            where,
            orderBy: { Timestamp: 'desc' },
            take: parseInt(limit),
            include: {
                User: {
                    select: { First_Name: true, Last_Name: true, Email: true }
                },
                Ticket: {
                    select: { Ticket_ID: true, Report_Problem: true, Status: true }
                },
                Booked_Room: {
                    select: { Booked_Room_ID: true, Status: true }
                }
            }
        });

        // Transform to frontend-friendly format
        const formatted = notifications.map(n => ({
            id: n.Log_ID,
            type: getNotificationType(n.Log_Type, n.Action),
            title: n.Action,
            message: formatNotificationMessage(n),
            time: formatTimeAgo(n.Timestamp),
            timestamp: n.Timestamp,
            read: n.Notification_Read_At !== null,
            readAt: n.Notification_Read_At,
            user: n.User,
            details: n.Details
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications', details: error.message });
    }
});

// PATCH /api/notifications/:id/read - Mark notification as read
router.patch('/:id/read', async (req, res) => {
    try {
        const logId = parseInt(req.params.id);

        const updated = await prisma.audit_Log.update({
            where: { Log_ID: logId },
            data: { Notification_Read_At: new Date() }
        });

        res.json({ success: true, notification: updated });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to update notification', details: error.message });
    }
});

// PATCH /api/notifications/read-all - Mark all as read
router.patch('/read-all', async (req, res) => {
    try {
        const result = await prisma.audit_Log.updateMany({
            where: {
                Is_Notification: true,
                Notification_Read_At: null
            },
            data: { Notification_Read_At: new Date() }
        });

        res.json({ success: true, count: result.count });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ error: 'Failed to update notifications', details: error.message });
    }
});

// Helper functions
function getNotificationType(logType, action) {
    const actionLower = action.toLowerCase();
    if (actionLower.includes('approved') || actionLower.includes('completed') || actionLower.includes('resolved')) {
        return 'success';
    }
    if (actionLower.includes('rejected') || actionLower.includes('failed') || actionLower.includes('error')) {
        return 'warning';
    }
    return 'info';
}

function formatNotificationMessage(notification) {
    const details = notification.Details;
    if (details && typeof details === 'object' && details.message) {
        return details.message;
    }

    // Build message from context
    let message = notification.Action;
    if (notification.User) {
        message += ` by ${notification.User.First_Name} ${notification.User.Last_Name}`;
    }
    return message;
}

function formatTimeAgo(date) {
    const now = new Date();
    const timestamp = new Date(date);
    const seconds = Math.floor((now - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

    return timestamp.toLocaleDateString();
}
>>>>>>> origin/main

module.exports = router;
