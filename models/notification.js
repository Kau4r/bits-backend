class Notification {
    constructor(id, userId, message, type, read = false) {
        this.id = id;
        this.userId = userId;
        this.message = message;
        this.type = type;
        this.read = read;
        this.createdAt = new Date().toISOString();
    }

    static validate(notification) {
        if (!notification.userId) throw new Error('User ID is required');
        if (!notification.message) throw new Error('Message is required');
        if (!notification.type) throw new Error('Notification type is required');
        
        const validTypes = ['info', 'warning', 'error', 'success'];
        if (!validTypes.includes(notification.type)) {
            throw new Error(`Invalid notification type. Must be one of: ${validTypes.join(', ')}`);
        }
    }

    static toResponse(notification) {
        return {
            id: notification.id,
            userId: notification.userId,
            message: notification.message,
            type: notification.type,
            read: notification.read,
            createdAt: notification.createdAt
        };
    }
}

module.exports = Notification;
