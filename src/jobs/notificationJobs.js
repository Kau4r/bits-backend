const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const NotificationService = require('../services/notificationService');

const prisma = new PrismaClient();

// Check for bookings ending soon and send notifications
const checkUpcomingBookings = async () => {
  try {
    console.log('Running checkUpcomingBookings job');
    
    // Find all active bookings ending in the next 10 minutes
    const now = new Date();
    const tenMinutesLater = new Date(now.getTime() + 10 * 60000);
    
    const upcomingBookings = await prisma.booking.findMany({
      where: {
        End_Date: {
          gte: now,
          lte: tenMinutesLater,
        },
        Status: 'ACTIVE',
        // Only notify if we haven't notified in the last 5 minutes
        // to avoid duplicate notifications
        NOT: {
          AuditLogs: {
            some: {
              Action: 'NOTIFICATION_SENT',
              Created_At: {
                gte: new Date(now.getTime() - 5 * 60000), // Last 5 minutes
              },
            },
          },
        },
      },
      include: {
        Item: true,
        User_Booking_User_IDToUser: true,
      },
    });

    // Send notifications for each upcoming booking
    for (const booking of upcomingBookings) {
      try {
        const minutesLeft = Math.ceil((booking.End_Date - now) / 60000);
        await NotificationService.notifyScheduleEnding(booking, minutesLeft);
        
        // Log that we've sent a notification for this booking
        await prisma.audit_Log.create({
          data: {
            User_ID: booking.User_ID,
            Action: 'NOTIFICATION_SENT',
            Details: `Sent notification for booking ${booking.Booking_ID} ending in ${minutesLeft} minutes`,
            Related_Entity_Type: 'BOOKING',
            Related_Entity_ID: booking.Booking_ID.toString(),
          },
        });
      } catch (error) {
        console.error(`Error sending notification for booking ${booking.Booking_ID}:`, error);
      }
    }
    
    console.log(`Sent notifications for ${upcomingBookings.length} upcoming bookings`);
  } catch (error) {
    console.error('Error in checkUpcomingBookings job:', error);
  }
};

// Check for forms that need attention (e.g., pending for 3 days)
const checkPendingForms = async () => {
  try {
    console.log('Running checkPendingForms job');
    
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const pendingForms = await prisma.form.findMany({
      where: {
        Status: 'PENDING_APPROVAL',
        Created_At: {
          lte: threeDaysAgo,
        },
        // Only notify if we haven't notified in the last 24 hours
        NOT: {
          AuditLogs: {
            some: {
              Action: 'PENDING_FORM_NOTIFICATION_SENT',
              Created_At: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
              },
            },
          },
        },
      },
      include: {
        User_Form_Approver_IDToUser: true, // Approver
        User_Form_Creator_IDToUser: true,  // Creator
      },
    });
    
    // Send notifications for each pending form
    for (const form of pendingForms) {
      try {
        // Notify the approver
        if (form.User_Form_Approver_IDToUser) {
          await NotificationService.createNotification({
            type: 'FORM_UPDATE_REMINDER',
            title: 'Pending Form Reminder',
            message: `Form "${form.Title}" has been pending for 3 days. Please review.`,
            priority: 'HIGH',
            recipientId: form.Approver_ID,
            relatedId: form.Form_ID,
            relatedType: 'form',
          });
          
          // Log that we've sent a notification for this form
          await prisma.audit_Log.create({
            data: {
              User_ID: form.Approver_ID,
              Action: 'PENDING_FORM_NOTIFICATION_SENT',
              Details: `Sent pending form notification for form ${form.Form_ID}`,
              Related_Entity_Type: 'FORM',
              Related_Entity_ID: form.Form_ID.toString(),
            },
          });
        }
      } catch (error) {
        console.error(`Error sending notification for form ${form.Form_ID}:`, error);
      }
    }
    
    console.log(`Sent notifications for ${pendingForms.length} pending forms`);
  } catch (error) {
    console.error('Error in checkPendingForms job:', error);
  }
};

// Check for room capacity
const checkRoomCapacity = async () => {
  try {
    console.log('Running checkRoomCapacity job');
    
    // Get all rooms that are currently in use
    const roomsInUse = await prisma.room.findMany({
      where: {
        Status: 'IN_USE',
      },
      include: {
        Computers: {
          where: {
            Status: 'IN_USE',
          },
        },
        _count: {
          select: { Computers: true },
        },
      },
    });
    
    // Check each room's capacity
    for (const room of roomsInUse) {
      try {
        const currentUsage = room._count.Computers;
        const usagePercentage = (currentUsage / room.Capacity) * 100;
        
        // If room is at or over capacity
        if (usagePercentage >= 100) {
          // Check if we've already sent a notification in the last hour
          const lastNotification = await prisma.audit_Log.findFirst({
            where: {
              Action: 'ROOM_FULL_NOTIFICATION_SENT',
              Related_Entity_Type: 'ROOM',
              Related_Entity_ID: room.Room_ID.toString(),
              Created_At: {
                gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
              },
            },
            orderBy: {
              Created_At: 'desc',
            },
          });
          
          if (!lastNotification) {
            // Send notification
            await NotificationService.notifyRoomFull(room);
            
            // Log the notification
            await prisma.audit_Log.create({
              data: {
                Action: 'ROOM_FULL_NOTIFICATION_SENT',
                Details: `Room ${room.Name} is at ${Math.round(usagePercentage)}% capacity`,
                Related_Entity_Type: 'ROOM',
                Related_Entity_ID: room.Room_ID.toString(),
              },
            });
          }
        }
      } catch (error) {
        console.error(`Error checking capacity for room ${room.Room_ID}:`, error);
      }
    }
    
    console.log('Completed room capacity check');
  } catch (error) {
    console.error('Error in checkRoomCapacity job:', error);
  }
};

// Initialize scheduled jobs
const initScheduledJobs = () => {
  // Check for upcoming bookings every minute
  cron.schedule('* * * * *', checkUpcomingBookings);
  
  // Check for pending forms every 6 hours
  cron.schedule('0 */6 * * *', checkPendingForms);
  
  // Check room capacity every 5 minutes
  cron.schedule('*/5 * * * *', checkRoomCapacity);
  
  console.log('Scheduled jobs initialized');
};

module.exports = {
  initScheduledJobs,
  checkUpcomingBookings,
  checkPendingForms,
  checkRoomCapacity,
};
