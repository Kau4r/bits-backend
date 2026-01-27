const WebSocket = require('ws');

const NotificationManager = {
    clients: new Map(), // userId -> Set of WebSocket connections

    add(userId, ws) {
        const id = String(userId);
        if (!this.clients.has(id)) {
            this.clients.set(id, new Set());
        }
        this.clients.get(id).add(ws);
        console.log(`[NotificationManager] User ${id} connected. Total connections: ${this.clients.get(id).size}`);
    },

    remove(userId, ws) {
        const id = String(userId);
        if (this.clients.has(id)) {
            const userClients = this.clients.get(id);
            userClients.delete(ws);
            console.log(`[NotificationManager] User ${id} disconnected. Remaining: ${userClients.size}`);
            if (userClients.size === 0) {
                this.clients.delete(id);
            }
        }
    },

    send(userId, data) {
        const id = String(userId);
        console.log(`[NotificationManager] Sending to User ${id} (Original: ${userId})`);
        if (this.clients.has(id)) {
            const sockets = this.clients.get(id);
            console.log(`[NotificationManager] User has ${sockets.size} active connections`);
            const message = JSON.stringify(data);
            let sentCount = 0;
            sockets.forEach(client => {
                try {
                    // Check if it's an SSE Response object (has .write method and .writableEnded)
                    if (client.write && typeof client.writableEnded !== 'undefined') {
                        // SSE Response
                        if (!client.writableEnded) {
                            client.write(`data: ${message}\n\n`);
                            sentCount++;
                            console.log(`[NotificationManager] Sent via SSE`);
                        } else {
                            console.log(`[NotificationManager] SSE connection already ended`);
                        }
                    } else if (client.readyState !== undefined) {
                        // WebSocket
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(message);
                            sentCount++;
                            console.log(`[NotificationManager] Sent via WebSocket`);
                        } else {
                            console.log(`[NotificationManager] WebSocket not open, state: ${client.readyState}`);
                        }
                    } else {
                        console.log(`[NotificationManager] Unknown client type`);
                    }
                } catch (err) {
                    console.error(`[NotificationManager] Error sending to client:`, err.message);
                }
            });
            console.log(`[NotificationManager] Sent to ${sentCount} connections`);
        } else {
            console.log(`[NotificationManager] User ${id} not found. Active users:`, [...this.clients.keys()]);
        }
    },

    // Broadcast to all connected clients (for system-wide alerts)
    broadcast(data) {
        const message = JSON.stringify(data);
        let sentCount = 0;
        this.clients.forEach((sockets, userId) => {
            sockets.forEach(client => {
                try {
                    if (client.write && typeof client.writableEnded !== 'undefined') {
                        // SSE Response
                        if (!client.writableEnded) {
                            client.write(`data: ${message}\n\n`);
                            sentCount++;
                        }
                    } else if (client.readyState === WebSocket.OPEN) {
                        // WebSocket
                        client.send(message);
                        sentCount++;
                    }
                } catch (err) {
                    console.error(`[NotificationManager] Error in broadcast:`, err.message);
                }
            });
        });
        console.log(`[NotificationManager] Broadcast sent to ${sentCount} clients`);
    },

    /**
     * Broadcast booking-related events to trigger UI updates.
     * @param {string} eventType - BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_APPROVED, BOOKING_REJECTED
     * @param {object} booking - Minimal booking data (Booked_Room_ID, Room_ID, Status, etc.)
     * @param {string[]} targetRoles - Array of roles to notify (e.g., ['LAB_HEAD', 'LAB_TECH'])
     */
    async broadcastBookingEvent(eventType, booking, targetRoles = []) {
        const prisma = require('../lib/prisma');

        const payload = {
            type: eventType,
            category: 'BOOKING_UPDATE',
            timestamp: new Date().toISOString(),
            booking: {
                id: booking.Booked_Room_ID,
                roomId: booking.Room_ID,
                status: booking.Status,
                startTime: booking.Start_Time,
                endTime: booking.End_Time,
                purpose: booking.Purpose,
                userId: booking.User_ID
            }
        };

        console.log(`[NotificationManager] Broadcasting ${eventType} to roles: ${targetRoles.join(', ')}`);

        // If no specific roles, broadcast to all
        if (targetRoles.length === 0) {
            this.broadcast(payload);
            return;
        }

        // Find all users with the specified roles and send to them
        try {
            const users = await prisma.user.findMany({
                where: { User_Role: { in: targetRoles } },
                select: { User_ID: true }
            });

            users.forEach(user => {
                this.send(user.User_ID, payload);
            });

            console.log(`[NotificationManager] Sent ${eventType} to ${users.length} users with roles: ${targetRoles.join(', ')}`);
        } catch (err) {
            console.error(`[NotificationManager] Error finding users for broadcast:`, err.message);
        }
    }
};

module.exports = NotificationManager;
