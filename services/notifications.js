const Notification = require('../models/notification');

// In-memory storage (replace with database in production)
let notifications = [];
let nextId = 1;

const notificationsService = {
    getAll: (userId) => {
        return notifications.filter(n => n.userId === userId)
            .map(Notification.toResponse);
    },

    getById: (userId, id) => {
        const notification = notifications.find(n => n.id === id && n.userId === userId);
        if (!notification) {
            throw new Error('Notification not found');
        }
        return Notification.toResponse(notification);
    },

    create: (userId, notificationData) => {
        Notification.validate(notificationData);
        
        const notification = new Notification(
            nextId++,
            userId,
            notificationData.message,
            notificationData.type,
            notificationData.read || false
        );

        notifications.push(notification);
        return Notification.toResponse(notification);
    },

    update: (userId, id, notificationData) => {
        const index = notifications.findIndex(n => n.id === id && n.userId === userId);
        if (index === -1) {
            throw new Error('Notification not found');
        }

        Notification.validate(notificationData);

        const updatedNotification = { ...notifications[index], ...notificationData };
        notifications[index] = updatedNotification;
        return Notification.toResponse(updatedNotification);
    },

    delete: (userId, id) => {
        const index = notifications.findIndex(n => n.id === id && n.userId === userId);
        if (index === -1) {
            throw new Error('Notification not found');
        }

        notifications.splice(index, 1);
        return { message: 'Notification deleted successfully' };
    }
};

module.exports = notificationsService;
