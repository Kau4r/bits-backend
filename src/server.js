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
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Trust proxy (required behind reverse proxy for rate limiting)
app.set('trust proxy', 1);
app.set('etag', false);

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

// Dynamic API responses should not be browser-cached. Several frontend flows
// immediately refetch after mutations, and a 304 response leaves Axios without
// usable JSON data.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Apply general rate limiting
app.use('/', generalLimiter);

// ==================== ROUTES ====================

// Health check (no rate limit)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    }
  });
});

// Auth routes with stricter rate limiting
app.use('/auth', authLimiter, require('./modules/auth/auth.routes'));

// API Routes
app.use('/inventory', require('./modules/inventory/inventory.routes'));
app.use('/users', require('./modules/users/users.routes'));
app.use('/tickets', require('./modules/tickets/tickets.routes'));
app.use('/rooms', require('./modules/rooms/rooms.routes'));
app.use('/bookings', require('./modules/bookings/bookings.routes'));
app.use('/computers', require('./modules/computers/computers.routes'));

app.use('/borrowing', require('./modules/borrowing/borrowing.routes'));
app.use('/notifications', require('./modules/notifications/notifications.routes'));
app.use('/forms', require('./modules/forms/forms.routes'));
app.use('/maintenance', require('./modules/maintenance/maintenance.routes'));
app.use('/schedules', require('./modules/schedules/schedules.routes'));
app.use('/upload', require('./modules/upload/upload.routes'));
app.use('/dashboard', require('./modules/dashboard/dashboard.routes'));
app.use('/heartbeat', require('./modules/heartbeat/heartbeat.routes'));
app.use('/reports', require('./modules/reports/reports.routes'));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ==================== ERROR HANDLING ====================

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Export app early for testing (before WebSocket setup)
module.exports.app = app;

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

// Graceful shutdown handler
const gracefulShutdown = async () => {
  console.log('[Server] Shutting down gracefully...');
  clearInterval(interval);
  wss.close();
  server.close(() => {
    prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);

module.exports.server = server;
module.exports.wss = wss;
