const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class NotificationService {
  // Create a new notification using Audit_Log
  static async createNotification({
    type,
    title,
    message,
    userId = null,
    relatedId = null,
    relatedType = null,
    data = {}
  }) {
    // Map notification type to appropriate log type
    const logType = this._getLogTypeFromNotificationType(type);
    
    // Prepare the notification data
    const notificationData = {
      Action: `NOTIFICATION_${type}`,
      Details: message,
      Is_Notification: true,
      Notification_Type: type,
      Notification_Data: Object.keys(data).length > 0 ? data : undefined,
      User_ID: userId,
      Log_Type: logType,
    };

    // Add related entity reference if provided
    if (relatedId && relatedType) {
      const relationField = `${relatedType}_ID`;
      notificationData[relationField] = relatedId;
    }

    return await prisma.audit_Log.create({
      data: notificationData
    });
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
      'ROOM_BOOKED': 'BOOKING',
      
      // Issues/Reports
      'ITEM_REPORTED': 'TICKET',
      'COMPUTER_REPORTED': 'TICKET',
      'TICKET_UPDATED': 'TICKET'
    };

    return typeMap[notificationType] || 'SYSTEM';
  }

  // Get notifications for a user
  static async getUserNotifications(userId, { limit = 20, cursor = null, unreadOnly = false } = {}) {
    const where = {
      OR: [
        { User_ID: userId },
        { User_ID: null, Is_Notification: true } // System-wide notifications
      ],
      Is_Notification: true
    };

    if (unreadOnly) {
      where.Notification_Read_At = null;
    }

    if (cursor) {
      where.Log_ID = { lt: cursor };
    }

    const notifications = await prisma.audit_Log.findMany({
      where,
      take: limit + 1, // Get one extra to determine if there are more
      orderBy: { Created_At: 'desc' },
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
            Title: true,
            Status: true
          }
        },
        Booking: {
          select: {
            Booking_ID: true,
            Status: true
          }
        },
        Borrowing: {
          select: {
            Borrow_Item_ID: true,
            Status: true
          }
        }
      }
    });

    let nextCursor = null;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = nextItem.Log_ID;
    }

    return {
      notifications,
      nextCursor
    };
  }

  // Mark a notification as read
  static async markAsRead(notificationId, userId) {
    return await prisma.audit_Log.updateMany({
      where: {
        Log_ID: notificationId,
        User_ID: userId,
        Is_Notification: true,
        Notification_Read_At: null
      },
      data: {
        Notification_Read_At: new Date()
      }
    });
  }

  // Mark all notifications as read for a user
  static async markAllAsRead(userId) {
    return await prisma.audit_Log.updateMany({
      where: {
        User_ID: userId,
        Is_Notification: true,
        Notification_Read_At: null
      },
      data: {
        Notification_Read_At: new Date()
      }
    });
  }

  // Get unread notification count for a user
  static async getUnreadCount(userId) {
    return await prisma.audit_Log.count({
      where: {
        OR: [
          { User_ID: userId },
          { User_ID: null, Is_Notification: true } // System-wide notifications
        ],
        Is_Notification: true,
        Notification_Read_At: null
      }
    });
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
        User_Role: 'LABTECH',
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
