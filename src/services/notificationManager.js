const NotificationManager = {
    clients: new Map(), // userId -> Set of response objects

    add(userId, res) {
        if (!this.clients.has(userId)) {
            this.clients.set(userId, new Set());
        }
        this.clients.get(userId).add(res);
    },

    remove(userId, res) {
        if (this.clients.has(userId)) {
            const userClients = this.clients.get(userId);
            userClients.delete(res);
            if (userClients.size === 0) {
                this.clients.delete(userId);
            }
        }
    },

    send(userId, data) {
        if (this.clients.has(userId)) {
            this.clients.get(userId).forEach(client => {
                client.write(`data: ${JSON.stringify(data)}\n\n`);
            });
        }
    }
};

module.exports = NotificationManager;
