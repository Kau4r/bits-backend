const prisma = require('../../lib/prisma');
const NotificationService = require('../../services/notificationService');

// Get user's notifications
const getNotifications = async (req, res) => {
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
      meta: { nextCursor },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
    });
  }
};

// Get unread notification count
const getUnreadCount = async (req, res) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user.User_ID);
    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unread count',
    });
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await NotificationService.markAsRead(parseInt(id), req.user.User_ID);

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found or already read',
      });
    }

    res.json({
      success: true,
      data: { message: 'Notification marked as read' },
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
    });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    await NotificationService.markAllAsRead(req.user.User_ID);
    res.json({
      success: true,
      data: { message: 'All notifications marked as read' },
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read',
    });
  }
};

// Get notification by ID
const getNotificationById = async (req, res) => {
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
        error: 'Notification not found',
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
      error: 'Failed to fetch notification',
    });
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNotificationById
};
