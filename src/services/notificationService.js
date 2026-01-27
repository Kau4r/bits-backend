const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NotificationManager = require('./notificationManager');

class NotificationService {
  /**
   * Send a real-time notification to a user.
   * NOTE: This should NOT create a database entry. The AuditLogger already creates
   * the audit log entry with Is_Notification=true. This method only handles 
   * the real-time push via NotificationManager.
   */
  static async createNotification({
    type,
    title,
    message,
    userId = null,
    logId = null,
    timestamp = null,
    data = {}
  }) {
    // Determine category based on type
    const logType = this._getLogTypeFromNotificationType(type);
    let category = 'NOTIFICATION';
    if (logType === 'BOOKING') category = 'BOOKING_UPDATE';
    if (logType === 'BORROWING') category = 'BORROWING_UPDATE';

    // Only send real-time notification if there's a userId
    if (userId) {
      console.log(`[NotificationService] Sending real-time via Manager to user: ${userId}`);
      NotificationManager.send(String(userId), {
        id: logId || Date.now(),
        type: type,
        category: category,
        title: title || type.replace(/_/g, ' '),
        message: message,
        time: timestamp || new Date().toISOString(),
        read: false
      });
    } else {
      console.log('[NotificationService] Skipping real-time send: No userId provided');
    }

    // Return a simple object for compatibility (no DB entry created)
    return {
      Log_ID: logId,
      Action: type,
      Details: message,
      User_ID: userId
    };
  }

  // Broadcast notification to all users with specific role(s), optionally excluding specific users
  static async notifyRole(roleOrRoles, notificationData, excludeUserIds = []) {
    try {
      const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
      const exclusions = Array.isArray(excludeUserIds) ? excludeUserIds : [excludeUserIds];

      const whereClause = {
        User_Role: { in: roles }
      };

      if (exclusions.length > 0) {
        // Filter out null/undefined values just in case
        const validExclusions = exclusions.filter(id => id !== null && id !== undefined);
        if (validExclusions.length > 0) {
          whereClause.User_ID = { notIn: validExclusions };
        }
      }

      const users = await prisma.User.findMany({
        where: whereClause,
        select: { User_ID: true }
      });

      const notifications = await Promise.all(
        users.map(user =>
          this.createNotification({
            ...notificationData,
            userId: user.User_ID
          })
        )
      );

      return notifications;
    } catch (error) {
      console.error(`Failed to broadcast to roles ${roleOrRoles}:`, error);
      // Don't throw, just log error to avoid breaking the main flow
      return [];
    }
  }

  // Helper to determine log type from notification type
  static _getLogTypeFromNotificationType(notificationType) {
    const typeMap = {
      // System Alerts
      'ITEM_SCHEDULE_ENDING': 'SYSTEM',
      'ROOM_FULL': 'SYSTEM',
      'ROOM_QUEUE': 'SYSTEM',

      // Form Updates
      'FORM_UPDATE_REMINDER': 'TICKET',
      'FORM_COMPLETED': 'TICKET',
      'FORM_APPROVED': 'TICKET',

      // System Notifications
      'COMPUTER_USAGE': 'SYSTEM',
      'ITEM_BORROWED': 'BORROWING',
      'COMPUTER_BORROWED': 'BORROWING',
      'BORROW_REQUESTED': 'BORROWING',
      'BORROW_APPROVED': 'BORROWING',
      'BORROW_REJECTED': 'BORROWING',
      'ITEM_RETURNED': 'BORROWING',
      'ROOM_BOOKED': 'BOOKING',
      'BOOKING_APPROVED': 'BOOKING',
      'BOOKING_CANCELLED': 'BOOKING',
      'TICKET_CREATED': 'TICKET',

      // Issues/Reports
      'ITEM_REPORTED': 'TICKET',
      'COMPUTER_REPORTED': 'TICKET',
      'TICKET_UPDATED': 'TICKET'
    };

    return typeMap[notificationType] || 'SYSTEM';
  }

  // Get notifications for a user
  static async getUserNotifications(userId, options = {}) {
    const { limit = 20, cursor, unreadOnly } = options;

    // Get user role
    const user = await prisma.User.findUnique({
      where: { User_ID: userId },
      select: { User_Role: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Build role-specific query
    let where;

    if (user.User_Role === 'FACULTY') {
      // Faculty ONLY sees approval/rejection notifications
      where = {
        Is_Notification: true,
        OR: [
          // Booking approvals/rejections where faculty is the requester
          {
            Action: { in: ['BOOKING_APPROVED', 'BOOKING_REJECTED'] },
            Booked_Room: {
              User_ID: userId
            }
          },
          // Borrow request approvals/rejections (filtered by target user)
          {
            Action: { in: ['BORROW_APPROVED', 'BORROW_REJECTED', 'ITEM_READY_FOR_PICKUP'] },
            Notification_Data: {
              path: ['targetUserId'],
              equals: userId
            }
          }
        ]
      };
    } else if (user.User_Role === 'STUDENT') {
      // Students see room availability notifications from staff
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId }, // Direct notifications
          { User_ID: null, Is_Notification: true }, // System-wide notifications
          // Room availability notifications for students
          {
            Action: { in: ['ROOM_AVAILABLE', 'ROOM_OPENED_FOR_STUDENTS'] }
          }
        ]
      };
    } else {
      // Other roles (LAB_HEAD, LAB_TECH, ADMIN)
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId }, // Direct notifications/actions by user
          { User_ID: null, Is_Notification: true }, // System-wide notifications
          // Role-Based Shared Notifications
          ...(user.User_Role === 'LAB_HEAD' ? [{
            Action: { in: ['ROOM_BOOKED', 'FORM_SUBMITTED', 'FORM_TRANSFERRED', 'TICKET_CREATED', 'BORROW_REQUESTED'] }
          }] : []),
          ...(user.User_Role === 'LAB_TECH' ? [{
            Action: { in: ['TICKET_CREATED', 'ITEM_BORROWED', 'COMPUTER_BORROWED', 'ITEM_RETURNED', 'COMPUTER_RETURNED', 'FORM_SUBMITTED', 'FORM_TRANSFERRED', 'FORM_APPROVED', 'FORM_REJECTED', 'BORROW_REQUESTED'] }
          }] : []),
        ]
      };
    }

    if (unreadOnly) {
      where.NotificationReads = {
        none: {
          User_ID: userId
        }
      };
    }

    if (cursor) {
      where.Log_ID = { lt: cursor };
    }

    const notifications = await prisma.Audit_Log.findMany({
      where,
      take: limit + 1, // Get one extra to determine if there are more
      orderBy: { Timestamp: 'desc' },
      include: {
        User: {
          select: {
            User_ID: true,
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        },
        Ticket: {
          select: {
            Ticket_ID: true,
            Status: true,
            Report_Problem: true
          }
        },
        Booked_Room: {
          select: {
            Booked_Room_ID: true,
            Status: true,
            Start_Time: true,
            End_Time: true,
            Room: {
              select: {
                Name: true
              }
            }
          }
        },
        NotificationReads: {
          where: {
            User_ID: userId
          },
          select: {
            Read_At: true
          }
        }
      }
    });

    let nextCursor = null;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = nextItem.Log_ID;
    }

    // Transform result to include polyfilled read status
    const transformedNotifications = notifications.map(n => {
      const readRecord = n.NotificationReads && n.NotificationReads[0];
      return {
        ...n,
        // If we found a read record for this user, use its timestamp, otherwise null
        Notification_Read_At: readRecord ? readRecord.Read_At : null,
        // Remove the helper relation from the final output if desirable, 
        // though keeping it doesn't hurt much.
        NotificationReads: undefined
      };
    });

    return {
      notifications: transformedNotifications,
      nextCursor
    };
  }

  // Mark a notification as read
  static async markAsRead(notificationId, userId) {
    try {
      // Try to create the read record. If it exists, unique constraint will throw or we can use upsert/ignore
      return await prisma.NotificationRead.upsert({
        where: {
          User_ID_Log_ID: {
            User_ID: userId,
            Log_ID: notificationId
          }
        },
        update: {}, // No update needed if exists
        create: {
          User_ID: userId,
          Log_ID: notificationId,
          Read_At: new Date()
        }
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  // Mark all notifications as read for a user
  static async markAllAsRead(userId) {
    // 1. Get all unread notifications for this user (reusing getUserNotifications logic partly)
    // We need to fetch the IDs of all notifications visible to this user that are NOT read.

    // Get user role
    const user = await prisma.User.findUnique({
      where: { User_ID: userId },
      select: { User_Role: true }
    });

    if (!user) return;

    // Build role-specific query (Duplicated logic from getUserNotifications for now, best to extract this)
    let where;

    if (user.User_Role === 'FACULTY') {
      where = {
        Is_Notification: true,
        OR: [
          {
            Action: { in: ['BOOKING_APPROVED', 'BOOKING_REJECTED'] },
            Booked_Room: { User_ID: userId }
          },
          // Borrow request approvals/rejections (filtered by target user)
          {
            Action: { in: ['BORROW_APPROVED', 'BORROW_REJECTED', 'ITEM_READY_FOR_PICKUP'] },
            Notification_Data: {
              path: ['targetUserId'],
              equals: userId
            }
          }
        ]
      };
    } else if (user.User_Role === 'STUDENT') {
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId },
          { User_ID: null, Is_Notification: true },
          {
            Action: { in: ['ROOM_AVAILABLE', 'ROOM_OPENED_FOR_STUDENTS'] }
          }
        ]
      };
    } else {
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId },
          { User_ID: null, Is_Notification: true },
          ...(user.User_Role === 'LAB_HEAD' ? [{
            Action: { in: ['ROOM_BOOKED', 'FORM_SUBMITTED', 'FORM_TRANSFERRED', 'TICKET_CREATED'] }
          }] : []),
          ...(user.User_Role === 'LAB_TECH' ? [{
            Action: { in: ['TICKET_CREATED', 'ITEM_BORROWED', 'COMPUTER_BORROWED', 'ITEM_RETURNED', 'COMPUTER_RETURNED'] }
          }] : []),
        ]
      };
    }

    // Only get those that don't have a read record for this user
    where.NotificationReads = {
      none: {
        User_ID: userId
      }
    };

    const unreadLogs = await prisma.Audit_Log.findMany({
      where,
      select: { Log_ID: true }
    });

    if (unreadLogs.length === 0) return { count: 0 };

    // Bulk create read records
    const readRecords = unreadLogs.map(log => ({
      User_ID: userId,
      Log_ID: log.Log_ID,
      Read_At: new Date()
    }));

    return await prisma.NotificationRead.createMany({
      data: readRecords,
      skipDuplicates: true
    });
  }

  // Get unread notification count for a user
  static async getUnreadCount(userId) {
    // Get user role to build role-specific query
    const user = await prisma.User.findUnique({
      where: { User_ID: userId },
      select: { User_Role: true }
    });

    if (!user) {
      return 0;
    }

    // Build role-specific query (same logic as getUserNotifications)
    let where;

    if (user.User_Role === 'FACULTY') {
      where = {
        Is_Notification: true,
        OR: [
          {
            Action: { in: ['BOOKING_APPROVED', 'BOOKING_REJECTED'] },
            Booked_Room: { User_ID: userId }
          },
          // Borrow request approvals/rejections (filtered by target user)
          {
            Action: { in: ['BORROW_APPROVED', 'BORROW_REJECTED', 'ITEM_READY_FOR_PICKUP'] },
            Notification_Data: {
              path: ['targetUserId'],
              equals: userId
            }
          }
        ]
      };
    } else if (user.User_Role === 'STUDENT') {
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId },
          { User_ID: null, Is_Notification: true },
          {
            Action: { in: ['ROOM_AVAILABLE', 'ROOM_OPENED_FOR_STUDENTS'] }
          }
        ]
      };
    } else {
      // LAB_HEAD, LAB_TECH, ADMIN
      where = {
        Is_Notification: true,
        OR: [
          { User_ID: userId },
          { User_ID: null, Is_Notification: true },
          ...(user.User_Role === 'LAB_HEAD' ? [{
            Action: { in: ['ROOM_BOOKED', 'FORM_SUBMITTED', 'FORM_TRANSFERRED', 'TICKET_CREATED'] }
          }] : []),
          ...(user.User_Role === 'LAB_TECH' ? [{
            Action: { in: ['TICKET_CREATED', 'ITEM_BORROWED', 'COMPUTER_BORROWED', 'ITEM_RETURNED', 'COMPUTER_RETURNED'] }
          }] : []),
        ]
      };
    }

    // Exclude read notifications
    where.NotificationReads = {
      none: {
        User_ID: userId
      }
    };

    return await prisma.Audit_Log.count({ where });
  }

  // Helper method to notify about schedule ending
  static async notifyScheduleEnding(scheduleId, minutesBefore = 10) {
    const schedule = await prisma.schedule.findUnique({
      where: { Schedule_ID: scheduleId },
      include: { User: true }
    });

    if (!schedule) return null;

    return this.createNotification({
      type: 'ITEM_SCHEDULE_ENDING',
      title: 'Schedule Ending Soon',
      message: `Your scheduled item "${schedule.Title}" is ending in ${minutesBefore} minutes`,
      userId: schedule.User_ID,
      relatedId: schedule.Schedule_ID,
      relatedType: 'Schedule',
      data: {
        endTime: schedule.End_Time,
        minutesBefore
      }
    });
  }

  // Notify when a room is full
  static async notifyRoomFull(room, user) {
    return this.createNotification({
      type: 'ROOM_FULL',
      title: 'Room at Full Capacity',
      message: `Room ${room.Room_Name} has reached its maximum capacity.`,
      userId: user.User_ID,
      relatedId: room.Room_ID,
      relatedType: 'Room',
      data: {
        roomName: room.Room_Name,
        capacity: room.Capacity,
        currentOccupancy: room.Current_Occupancy
      }
    });
  }

  // Notify about form status updates
  static async notifyFormStatusUpdate(form) {
    let title, message, type;

    switch (form.Status) {
      case 'PENDING_APPROVAL':
        title = 'Form Requires Approval';
        message = `Form "${form.Title}" is pending your approval.`;
        type = 'FORM_UPDATE_REMINDER';
        break;
      case 'APPROVED':
        title = 'Form Approved';
        message = `Your form "${form.Title}" has been approved.`;
        type = 'FORM_APPROVED';
        break;
      case 'REJECTED':
        title = 'Form Rejected';
        message = `Your form "${form.Title}" has been rejected.`;
        type = 'FORM_UPDATE_REMINDER';
        break;
      default:
        return null;
    }

    return this.createNotification({
      type,
      title,
      message,
      userId: form.Creator_ID,
      relatedId: form.Form_ID,
      relatedType: 'Form',
      data: {
        status: form.Status,
        title: form.Title
      }
    });
  }

  // Notify when an item is borrowed
  static async notifyItemBorrowed(item, user) {
    return this.createNotification({
      type: 'ITEM_BORROWED',
      title: 'Item Borrowed',
      message: `You have borrowed ${item.Item_Code} (${item.Brand || 'No Brand'}).`,
      userId: user.User_ID,
      relatedId: item.Item_ID,
      relatedType: 'Item',
      data: {
        itemCode: item.Item_Code,
        brand: item.Brand,
        description: item.Description
      }
    });
  }

  // Notify when a new ticket is created
  static async notifyTicketCreated(ticket) {
    // Notify all lab technicians
    const labTechs = await prisma.user.findMany({
      where: {
        User_Role: 'LAB_TECH',
      },
      select: {
        User_ID: true,
      },
    });

    const notifications = [];
    for (const tech of labTechs) {
      const notification = await this.createNotification({
        type: 'TICKET_UPDATED',
        title: 'New Ticket Created',
        message: `Ticket #${ticket.Ticket_ID} has been created: ${ticket.Report_Problem.substring(0, 50)}...`,
        userId: tech.User_ID,
        relatedId: ticket.Ticket_ID,
        relatedType: 'Ticket',
        data: {
          title: ticket.Title,
          status: ticket.Status,
          priority: ticket.Priority
        }
      });
      notifications.push(notification);
    }

    return notifications;
  }
}

module.exports = NotificationService;
