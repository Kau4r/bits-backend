const WebSocket = require('ws');
const NotificationService = require('./notificationService');
const { verifyToken } = require('../middleware/auth');

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Map(); // userId -> WebSocket
    this.setupWebSocket(server);
  }

  setupWebSocket(server) {
    // Handle HTTP server upgrade to WebSocket
    server.on('upgrade', (request, socket, head) => {
      // Extract token from the URL query parameters
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify JWT token
      verifyToken(token, (err, user) => {
        if (err) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request, user);
        });
      });
    });

    // Handle new WebSocket connections
    this.wss.on('connection', (ws, request, user) => {
      const userId = user.User_ID;
      console.log(`New WebSocket connection for user ${userId}`);

      // Store the WebSocket connection
      this.clients.set(userId, ws);

      // Send unread count on connection
      this.sendUnreadCount(userId);

      // Handle WebSocket close
      ws.on('close', () => {
        console.log(`WebSocket connection closed for user ${userId}`);
        if (this.clients.get(userId) === ws) {
          this.clients.delete(userId);
        }
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for user ${userId}:`, error);
        if (this.clients.get(userId) === ws) {
          this.clients.delete(userId);
        }
      });
    });
  }

  // Send a notification to a specific user
  async sendNotification(userId, notification) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'NOTIFICATION',
        data: notification,
      }));
      return true;
    }
    return false;
  }

  // Send unread count to a specific user
  async sendUnreadCount(userId) {
    const count = await NotificationService.getUnreadCount(userId);
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'UNREAD_COUNT',
        count,
      }));
      return true;
    }
    return false;
  }

  // Broadcast a notification to all connected users (for system-wide notifications)
  broadcastNotification(notification) {
    const message = JSON.stringify({
      type: 'NOTIFICATION',
      data: notification,
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Notify user about a new notification
  async notifyUser(userId, notification) {
    const sent = await this.sendNotification(userId, notification);
    if (sent) {
      await this.sendUnreadCount(userId);
    }
    return sent;
  }

  // Notify all users (for system-wide notifications)
  async broadcast(notification) {
    // Save notification to database with recipientId = null for broadcast
    const savedNotification = await NotificationService.createNotification({
      ...notification,
      recipientId: null, // null means broadcast to all
    });

    // Broadcast to all connected clients
    this.broadcastNotification(savedNotification);
  }
}

module.exports = WebSocketService;
