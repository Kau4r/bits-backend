/**
 * Get the color for a notification based on its type
 * @param {string} notificationType - The type of the notification
 * @returns {Object} - Object containing background and text color classes
 */
const getNotificationColor = (notificationType) => {
  // System Alerts (Yellow)
  const systemAlerts = [
    'ITEM_SCHEDULE_ENDING',
    'ROOM_FULL',
    'ROOM_QUEUE',
  ];

  // Form Updates (Green)
  const formUpdates = [
    'FORM_UPDATE_REMINDER',
    'FORM_COMPLETED',
    'FORM_APPROVED',
  ];

  // System Notifications (Blue)
  const systemNotifications = [
    'COMPUTER_USAGE',
    'ITEM_BORROWED',
    'ROOM_BOOKED',
  ];

  // Issues/Reports (Red)
  const issues = [
    'ITEM_REPORTED',
    'COMPUTER_REPORTED',
    'TICKET_UPDATED',
  ];

  if (systemAlerts.includes(notificationType)) {
    return {
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-800',
      iconColor: 'text-yellow-400',
      borderColor: 'border-yellow-200',
    };
  }

  if (formUpdates.includes(notificationType)) {
    return {
      bgColor: 'bg-green-50',
      textColor: 'text-green-800',
      iconColor: 'text-green-400',
      borderColor: 'border-green-200',
    };
  }

  if (systemNotifications.includes(notificationType)) {
    return {
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-800',
      iconColor: 'text-blue-400',
      borderColor: 'border-blue-200',
    };
  }

  if (issues.includes(notificationType)) {
    return {
      bgColor: 'bg-red-50',
      textColor: 'text-red-800',
      iconColor: 'text-red-400',
      borderColor: 'border-red-200',
    };
  }

  // Default colors
  return {
    bgColor: 'bg-gray-50',
    textColor: 'text-gray-800',
    iconColor: 'text-gray-400',
    borderColor: 'border-gray-200',
  };
};

/**
 * Get the icon for a notification based on its type
 * @param {string} notificationType - The type of the notification
 * @returns {string} - The name of the icon
 */
const getNotificationIcon = (notificationType) => {
  const icons = {
    // System Alerts
    ITEM_SCHEDULE_ENDING: 'clock',
    ROOM_FULL: 'users',
    ROOM_QUEUE: 'list',
    
    // Form Updates
    FORM_UPDATE_REMINDER: 'alert-circle',
    FORM_COMPLETED: 'check-circle',
    FORM_APPROVED: 'thumbs-up',
    
    // System Notifications
    COMPUTER_USAGE: 'monitor',
    ITEM_BORROWED: 'package',
    ROOM_BOOKED: 'calendar',
    
    // Issues/Reports
    ITEM_REPORTED: 'alert-triangle',
    COMPUTER_REPORTED: 'alert-triangle',
    TICKET_UPDATED: 'message-square',
  };

  return icons[notificationType] || 'bell';
};

/**
 * Get the action text for a notification based on its type
 * @param {string} notificationType - The type of the notification
 * @returns {string} - The action text
 */
const getNotificationAction = (notificationType) => {
  const actions = {
    ITEM_SCHEDULE_ENDING: 'View Schedule',
    ROOM_FULL: 'View Room',
    ROOM_QUEUE: 'View Queue',
    FORM_UPDATE_REMINDER: 'View Form',
    FORM_COMPLETED: 'View Form',
    FORM_APPROVED: 'View Form',
    COMPUTER_USAGE: 'View Usage',
    ITEM_BORROWED: 'View Item',
    ROOM_BOOKED: 'View Booking',
    ITEM_REPORTED: 'View Report',
    COMPUTER_REPORTED: 'View Report',
    TICKET_UPDATED: 'View Ticket',
  };

  return actions[notificationType] || 'View Details';
};

module.exports = {
  getNotificationColor,
  getNotificationIcon,
  getNotificationAction,
};
