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
            console.log(`[NotificationManager] User has ${sockets.size} active sockets`);
            const message = JSON.stringify(data);
            let sentCount = 0;
            sockets.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                    sentCount++;
                } else {
                    console.log(`[NotificationManager] Socket not open state: ${ws.readyState}`);
                }
            });
            console.log(`[NotificationManager] Sent to ${sentCount} sockets`);
        } else {
            console.log(`[NotificationManager] User ${id} not found. Active users:`, [...this.clients.keys()]);
        }
    },

    // Broadcast to all connected clients (for system-wide alerts)
    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach((sockets, userId) => {
            sockets.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            });
        });
    }
};

module.exports = NotificationManager;
