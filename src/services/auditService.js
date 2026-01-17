const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AuditService {
  // Log user authentication events
  static async logAuthEvent(userId, action, details = {}) {
    return this._createLog({
      userId,
      action: `AUTH_${action}`,
      details: details,  // Remove JSON.stringify() as Prisma handles JSON serialization
      logType: 'AUTH',
      relatedId: userId,
      relatedType: 'USER'
    });
  }

  // Log item management events
  static async logItemEvent(userId, action, itemId, details = {}) {
    return this._createLog({
      userId,
      action: `ITEM_${action}`,
      details: details,  // Remove JSON.stringify() as Prisma handles JSON serialization
      logType: 'ITEM',
      relatedId: itemId,
      relatedType: 'ITEM'
    });
  }

  // Log borrowing system events
  static async logBorrowingEvent(userId, action, borrowId, details = {}) {
    return this._createLog({
      userId,
      action: `BORROW_${action}`,
      details: details,  // Remove JSON.stringify() as Prisma handles JSON serialization
      logType: 'BORROW',
      relatedId: borrowId,
      relatedType: 'BORROW_ITEM'
    });
  }

  // Log room booking events
  static async logBookingEvent(userId, action, bookingId, details = {}) {
    return this._createLog({
      userId,
      action: `BOOKING_${action}`,
      details: details,  // Remove JSON.stringify() as Prisma handles JSON serialization
      logType: 'BOOKING',
      relatedId: bookingId,
      relatedType: 'BOOKED_ROOM'
    });
  }

  // Log ticket events
  static async logTicketEvent(userId, action, ticketId, details = {}) {
    return this._createLog({
      userId,
      action: `TICKET_${action}`,
      details: details,  // Remove JSON.stringify() as Prisma handles JSON serialization
      logType: 'TICKET',
      relatedId: ticketId,
      relatedType: 'TICKET'
    });
  }

  // Generic log creation method
  static async _createLog({ userId, action, details = {}, logType, relatedId, relatedType }) {
    try {
      // Ensure details is an object
      const detailsObj = typeof details === 'string' ? JSON.parse(details) : details;

      // Log the data for debugging
      console.log('Creating audit log with data:', {
        userId,
        action,
        logType,
        relatedId,
        relatedType,
        details: detailsObj
      });

      // Create the log data with proper relation
      const logData = {
        Action: action,
        Details: detailsObj,  // Pass the object directly, Prisma will handle JSON serialization
        Log_Type: logType,
        Timestamp: new Date(),
        User: userId ? {
          connect: { User_ID: userId }
        } : undefined
      };

      // Add related entity reference if provided
      // Only add if it's not a USER relation (since we already have User connected)
      if (relatedId && relatedType && relatedType !== 'USER') {
        const relationField = relatedType.charAt(0).toUpperCase() + relatedType.slice(1).toLowerCase();
        logData[relationField] = { connect: { [`${relationField}_ID`]: relatedId } };
      }

      const createdLog = await prisma.audit_Log.create({
        data: logData,
        include: {
          User: {
            select: {
              User_ID: true,
              Email: true,
              First_Name: true,
              Last_Name: true
            }
          }
        }
      });

      console.log('Successfully created audit log:', createdLog);
      return createdLog;
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't fail the main operation if logging fails
      return null;
    }
  }
}

module.exports = AuditService;
