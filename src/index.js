require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const path = require('path');

const prisma = require('./lib/prisma');
const NotificationManager = require('./services/notificationManager');
const { login, logout, authenticateToken, JWT_SECRET } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// ==================== SECURITY MIDDLEWARE ====================

// Helmet: Set security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin for uploaded files
}));

// Morgan: Request logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Rate limiting for general API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per window
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per window
  message: {
    success: false,
    error: 'Too many login attempts, please try again in 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(null, true); // In development, allow all; in production, consider stricter
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply general rate limiting
app.use('/api/', generalLimiter);

// ==================== ROUTES ====================

// Health check (no rate limit)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Auth routes with stricter rate limiting
app.post('/api/auth/login', authLimiter, login);
app.post('/api/auth/logout', authenticateToken, logout);

// API Routes
app.use('/api/inventory', require('../routes/inventory'));
app.use('/api/users', require('../routes/users'));
app.use('/api/tickets', require('../routes/tickets'));
app.use('/api/rooms', require('../routes/rooms'));
app.use('/api/bookings', require('../routes/bookings'));
app.use('/api/computers', require('../routes/computers'));

app.use('/api/borrowing', require('../routes/borrowing'));
app.use('/api/notifications', require('../routes/notifications'));
app.use('/api/forms', require('../routes/forms'));
app.use('/api/upload', require('../routes/upload'));
app.use('/api/dashboard', require('../routes/dashboard'));
app.use('/api/heartbeat', require('../routes/heartbeat'));
app.use('/api/reports', require('../routes/reports'));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ==================== ERROR HANDLING ====================

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ==================== SERVER SETUP ====================

const server = http.createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server, path: '/ws/notifications' });

wss.on('connection', async (ws, req) => {
  // Extract token from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Authentication required');
    return;
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    // Verify user exists and is active
    const user = await prisma.user.findUnique({
      where: { User_ID: userId }
    });

    if (!user) {
      ws.close(4002, 'User not found');
      return;
    }

    if (user.Is_Active === false) {
      ws.close(4003, 'Account is deactivated');
      return;
    }

    console.log(`[WebSocket] User ${userId} connected`);

    // Add to NotificationManager
    NotificationManager.add(userId, ws);

    // Send initial ping to confirm connection
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'WebSocket connected successfully' }));

    // Handle ping/pong for keep-alive
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`[WebSocket] Message from user ${userId}:`, data.type);
      } catch (e) {
        // Ignore invalid JSON
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      console.log(`[WebSocket] User ${userId} disconnected`);
      NotificationManager.remove(userId, ws);
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error for user ${userId}:`, error.message);
      NotificationManager.remove(userId, ws);
    });

  } catch (error) {
    console.error('[WebSocket] Auth failed:', error.message);
    ws.close(4004, 'Invalid token');
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

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[WebSocket] Available at ws://localhost:${PORT}/ws/notifications`);

  // Initialize scheduled jobs
  const { initHeartbeatMonitor } = require('./jobs/heartbeatMonitor');
  initHeartbeatMonitor();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  clearInterval(interval);
  wss.close();
  server.close(() => {
    prisma.$disconnect();
    process.exit(0);
  });
});

module.exports = app;
