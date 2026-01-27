const { PrismaClient } = require('@prisma/client');
const NotificationService = require('../services/notificationService');
const prisma = new PrismaClient();

/**
 * Centralized audit logging utility for the BITS system.
 * Handles both activity logging and notification creation.
 */
class AuditLogger {
    /**
     * Create an audit log entry and optionally send notifications.
     * 
     * @param {Object} options
     * @param {number} options.userId - User performing the action
     * @param {string} options.action - Action type (e.g., 'USER_LOGIN', 'ROOM_BOOKED')
     * @param {string} options.logType - Category (TICKET, BOOKING, BORROWING, FORM, ROOM, INVENTORY, AUTH, SYSTEM)
     * @param {boolean} options.isNotification - Whether this should appear as user notification
     * @param {string} options.notifyRole - Role to notify (LAB_HEAD, LAB_TECH, FACULTY)
     * @param {number} options.notifyUserId - Specific user to notify
     * @param {string} options.details - Human-readable description
     * @param {number} options.ticketId - Related ticket ID
     * @param {number} options.bookedRoomId - Related booking ID
     * @param {Object} options.notificationData - Additional JSON data for notification
     */
    static async log({
        userId,
        action,
        logType = 'SYSTEM',
        isNotification = false,
        notifyRole = null,
        notifyUserId = null,
        details = null,
        ticketId = null,
        bookedRoomId = null,
        notificationData = null
    }) {
        let log = null;
        try {
            console.log(`[AuditLogger] Attempting to log: ${action}, logType: ${logType}, userId: ${userId}`);

            // Create audit log entry
            log = await prisma.Audit_Log.create({
                data: {
                    User_ID: userId || null,
                    Action: action,
                    Log_Type: logType,
                    Is_Notification: isNotification,
                    Details: details,
                    Ticket_ID: ticketId || null,
                    Booked_Room_ID: bookedRoomId || null,
                    Notification_Type: isNotification ? action : null,
                    Notification_Data: notificationData || null
                }
            });

            console.log(`[AuditLogger] Audit entry created with ID: ${log.Log_ID}`);

            // Send real-time notifications if needed
            if (isNotification) {
                const notificationPayload = {
                    type: action,
                    title: this._getTitle(action),
                    message: details || this._getDefaultMessage(action),
                    timestamp: new Date().toISOString(),
                    logId: log.Log_ID,
                    data: notificationData
                };

                if (notifyRole) {
                    const roles = Array.isArray(notifyRole) ? notifyRole : [notifyRole];
                    console.log(`[AuditLogger] Sending real-time notification to roles: ${roles.join(', ')}`);

                    try {
                        // Exclude the specific notifyUserId from role-based broadcast to prevent duplicates
                        await NotificationService.notifyRole(roles, notificationPayload, notifyUserId);
                        console.log(`[AuditLogger] Notification sent to roles: ${roles.join(', ')}`);
                    } catch (notifyError) {
                        console.error(`[AuditLogger] Failed to notify roles ${roles}:`, notifyError.message);
                    }
                }

                if (notifyUserId) {
                    console.log(`[AuditLogger] Sending notification to user: ${notifyUserId}`);
                    try {
                        await NotificationService.createNotification({
                            userId: notifyUserId,
                            ...notificationPayload
                        });
                        console.log(`[AuditLogger] Notification sent to user: ${notifyUserId}`);
                    } catch (notifyError) {
                        console.error(`[AuditLogger] Failed to notify user ${notifyUserId}:`, notifyError.message);
                    }
                }
            }

            console.log(`[AuditLogger] ${action} logged successfully for user ${userId}`);
            return log;

        } catch (error) {
            console.error(`[AuditLogger] Failed to log ${action}:`, error.message);
            console.error(`[AuditLogger] Full error:`, error);
            // Don't throw - logging should never break main flow
            return log; // Return log if it was created before error
        }
    }

    /**
     * Get human-readable title for notification
     */
    static _getTitle(action) {
        const titles = {
            // Authentication
            'USER_LOGIN': 'User Logged In',
            'USER_LOGOUT': 'User Logged Out',
            'USER_CREATED': 'New User Created',

            // Bookings
            'ROOM_BOOKED': 'New Room Booking',
            'BOOKING_APPROVED': 'Booking Approved',
            'BOOKING_REJECTED': 'Booking Rejected',
            'BOOKING_CANCELLED': 'Booking Cancelled',
            'BOOKING_UPDATED': 'Booking Updated',

            // Tickets
            'TICKET_CREATED': 'New Ticket Reported',
            'TICKET_ASSIGNED': 'Ticket Assigned',
            'TICKET_RESOLVED': 'Ticket Resolved',
            'TICKET_UPDATED': 'Ticket Updated',
            'TICKET_ARCHIVED': 'Ticket Archived',

            // Borrowing
            'ITEM_BORROWED': 'Item Borrowed',
            'COMPUTER_BORROWED': 'Computer Borrowed',
            'ITEM_RETURNED': 'Item Returned',
            'ITEM_OVERDUE': 'Item Overdue',
            'BORROW_REQUESTED': 'New Borrow Request',
            'BORROW_APPROVED': 'Borrow Request Approved',
            'BORROW_REJECTED': 'Borrow Request Rejected',

            // Forms
            'FORM_SUBMITTED': 'New Form Submitted',
            'FORM_APPROVED': 'Form Approved',
            'FORM_REJECTED': 'Form Rejected',
            'FORM_UPDATED': 'Form Updated',
            'FORM_PENDING': 'Form Pending',
            'FORM_IN_REVIEW': 'Form In Review',
            'FORM_TRANSFERRED': 'Form Transferred',
            'FORM_ARCHIVED': 'Form Archived',

            // Inventory
            'ITEM_CREATED': 'Item Added to Inventory',
            'ITEM_UPDATED': 'Inventory Item Updated',
            'ITEM_DELETED': 'Item Removed from Inventory',
            'LOW_INVENTORY_ALERT': 'Low Inventory Warning',

            // Rooms
            'ROOM_OPENED': 'Room Opened',
            'ROOM_CLOSED': 'Room Closed',
            'ROOM_UPDATED': 'Room Updated'
        };
        return titles[action] || action.replace(/_/g, ' ');
    }

    /**
     * Get default message when details not provided
     */
    static _getDefaultMessage(action) {
        return `Action: ${action.replace(/_/g, ' ').toLowerCase()}`;
    }

    // ========== CONVENIENCE METHODS ==========

    /**
     * Log user authentication event
     */
    static async logAuth(userId, action, details = null, req = null) {
        const requestDetails = req ? {
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers?.['user-agent']
        } : null;

        return this.log({
            userId,
            action,
            logType: 'AUTH',
            isNotification: false,
            details: details || (requestDetails ? JSON.stringify(requestDetails) : null)
        });
    }

    /**
     * Log booking event with optional notification
     */
    static async logBooking(userId, action, bookedRoomId, details, notifyRole = null, notifyUserId = null) {
        return this.log({
            userId,
            action,
            logType: 'BOOKING',
            isNotification: !!(notifyRole || notifyUserId),
            notifyRole,
            notifyUserId,
            bookedRoomId,
            details
        });
    }

    /**
     * Log ticket event with optional notification
     */
    static async logTicket(userId, action, ticketId, details, notifyRole = null, notifyUserId = null) {
        return this.log({
            userId,
            action,
            logType: 'TICKET',
            isNotification: !!(notifyRole || notifyUserId),
            notifyRole,
            notifyUserId,
            ticketId,
            details
        });
    }

    /**
     * Log borrowing event with optional notification
     */
    static async logBorrowing(userId, action, details, notifyRole = null, notifyUserId = null) {
        return this.log({
            userId,
            action,
            logType: 'BORROWING',
            isNotification: !!(notifyRole || notifyUserId),
            notifyRole,
            notifyUserId,
            details,
            notificationData: notifyUserId ? { targetUserId: notifyUserId } : null
        });
    }

    /**
     * Log form event with optional notification
     */
    static async logForm(userId, action, details, notifyRole = null, notifyUserId = null) {
        return this.log({
            userId,
            action,
            logType: 'FORM',
            isNotification: !!(notifyRole || notifyUserId),
            notifyRole,
            notifyUserId,
            details
        });
    }

    /**
     * Log inventory event (usually not a notification)
     */
    static async logInventory(userId, action, details) {
        return this.log({
            userId,
            action,
            logType: 'INVENTORY',
            isNotification: false,
            details
        });
    }

    /**
     * Log room event (usually not a notification)
     */
    static async logRoom(userId, action, details) {
        return this.log({
            userId,
            action,
            logType: 'ROOM',
            isNotification: false,
            details
        });
    }
}

module.exports = AuditLogger;
