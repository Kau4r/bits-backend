const NotificationService = require('../services/notificationService');

/**
 * Middleware to send notification when a form status is updated
 */
const notifyFormStatusUpdate = async (req, res, next) => {
  try {
    // Call next first to let the route handler complete
    await next();

    // Only proceed if the form was updated successfully
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const { formId } = req.params;
      const { status } = req.body;
      
      // Skip if no status was updated
      if (!status) return;

      // Get the updated form
      const form = await req.prisma.form.findUnique({
        where: { Form_ID: parseInt(formId) },
      });

      if (form) {
        await NotificationService.notifyFormStatusUpdate(form);
      }
    }
  } catch (error) {
    console.error('Error in notifyFormStatusUpdate middleware:', error);
    // Don't fail the request if notification fails
  }
};

/**
 * Middleware to send notification when a ticket is created or updated
 */
const notifyTicketUpdate = async (req, res, next) => {
  try {
    // Call next first to let the route handler complete
    await next();

    // Only proceed if the ticket was created/updated successfully
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const { ticketId } = req.params;
      
      // Get the updated ticket
      const ticket = await req.prisma.ticket.findUnique({
        where: { Ticket_ID: parseInt(ticketId) },
        include: {
          Reported_By: true,
          Item: true,
          Room: true,
        },
      });

      if (ticket) {
        // If this is a new ticket, notify all lab technicians
        if (req.method === 'POST') {
          await NotificationService.notifyTicketCreated(ticket);
        }
        // If ticket status was updated, notify the reporter
        else if (req.method === 'PATCH' && req.body.status) {
          const title = `Ticket #${ticket.Ticket_ID} Status Update`;
          const message = `Your ticket "${ticket.Report_Problem.substring(0, 50)}..." has been updated to ${req.body.status}.`;
          
          await NotificationService.createNotification({
            type: 'TICKET_UPDATED',
            title,
            message,
            priority: 'MEDIUM',
            recipientId: ticket.Reported_By.User_ID,
            relatedId: ticket.Ticket_ID,
            relatedType: 'ticket',
          });
        }
      }
    }
  } catch (error) {
    console.error('Error in notifyTicketUpdate middleware:', error);
    // Don't fail the request if notification fails
  }
};

/**
 * Middleware to send notification when a booking is about to end
 */
const notifyBookingEnding = async (req, res, next) => {
  try {
    // This would typically be called by a scheduled job, but we'll implement the handler here
    const { bookingId, minutesBefore = 10 } = req.params;
    
    const booking = await req.prisma.booking.findUnique({
      where: { Booking_ID: parseInt(bookingId) },
      include: {
        Item: true,
        User_Booking_User_IDToUser: true,
      },
    });

    if (booking) {
      await NotificationService.notifyScheduleEnding(booking, minutesBefore);
    }

    next();
  } catch (error) {
    console.error('Error in notifyBookingEnding middleware:', error);
    next(error);
  }
};

/**
 * Middleware to send notification when an item is borrowed
 */
const notifyItemBorrowed = async (req, res, next) => {
  try {
    // Call next first to let the route handler complete
    await next();

    // Only proceed if the item was borrowed successfully
    if (res.statusCode >= 200 && res.statusCode < 300 && req.method === 'POST') {
      const { itemId } = req.params;
      const userId = req.user?.User_ID;
      
      if (!userId) return;

      // Get the item and user details
      const [item, user] = await Promise.all([
        req.prisma.item.findUnique({
          where: { Item_ID: parseInt(itemId) },
        }),
        req.prisma.user.findUnique({
          where: { User_ID: userId },
        }),
      ]);

      if (item && user) {
        await NotificationService.notifyItemBorrowed(item, user);
      }
    }
  } catch (error) {
    console.error('Error in notifyItemBorrowed middleware:', error);
    // Don't fail the request if notification fails
  }
};

module.exports = {
  notifyFormStatusUpdate,
  notifyTicketUpdate,
  notifyBookingEnding,
  notifyItemBorrowed,
};
