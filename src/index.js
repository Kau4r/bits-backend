console.log('Starting server initialization...');
require('dotenv').config();
console.log('Dotenv loaded');
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const NotificationManager = require('./services/notificationManager');

console.log('Initializing Express and Prisma...');
const app = express();
const prisma = new PrismaClient();
const { login, logout, authenticateToken } = require('./middleware/auth');

// Middleware
// Middleware
app.use((req, res, next) => {
  console.log(`[API Request] ${req.method} ${req.path}`);
  next();
});

app.use(cors()); // Reverting to default CORS to debug login
app.use(express.json());

// Auth routes
console.log('Registering routes...');
app.post('/api/auth/login', login);
app.post('/api/auth/logout', authenticateToken, logout);
app.use('/api/inventory', require('../routes/inventory'));
app.use('/api/users', require('../routes/users'));
app.use('/api/tickets', require('../routes/tickets'));
app.use('/api/rooms', require('../routes/rooms'));
app.use('/api/bookings', require('../routes/bookings'));
app.use('/api/computers', require('../routes/computers'));
app.use('/api/borrowing', require('../routes/borrowing'));
console.log('Registering notifications route...');
app.use('/api/notifications', require('../routes/notifications'));
app.use('/api/forms', require('../routes/forms'));
app.use('/api/upload', require('../routes/upload'));
app.use('/uploads', express.static(require('path').join(__dirname, '../uploads')));
console.log('Registering dashboard route...');
app.use('/api/dashboard', require('../routes/dashboard'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Create HTTP server from Express app
const server = http.createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server, path: '/ws/notifications' });

wss.on('connection', async (ws, req) => {
  console.log('[WebSocket] New connection attempt...');

  // Extract token from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.log('[WebSocket] No token provided, closing connection.');
    ws.close(4001, 'Authentication required');
    return;
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const userId = decoded.userId;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { User_ID: userId }
    });

    if (!user) {
      console.log('[WebSocket] User not found, closing connection.');
      ws.close(4002, 'User not found');
      return;
    }

    console.log(`[WebSocket] User ${userId} authenticated and connected.`);

    // Add to NotificationManager
    NotificationManager.add(userId, ws);

    // Send initial ping to confirm connection
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'WebSocket connected successfully' }));

    // Handle ping/pong for keep-alive
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle client messages (if needed for future bidirectional communication)
    ws.on('message', (message) => {
      console.log(`[WebSocket] Received from user ${userId}:`, message.toString());
      // Handle incoming messages if needed
    });

    // Handle disconnect
    ws.on('close', () => {
      console.log(`[WebSocket] User ${userId} disconnected.`);
      NotificationManager.remove(userId, ws);
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error for user ${userId}:`, error);
      NotificationManager.remove(userId, ws);
    });

  } catch (error) {
    console.error('[WebSocket] Authentication failed:', error.message);
    ws.close(4003, 'Invalid token');
  }
});

// Keep-alive interval: ping all clients every 30 seconds
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
console.log(`Attempting to listen on port ${PORT}...`);
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws/notifications`);
});
console.log('Server setup complete, listener registered.');
