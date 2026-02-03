const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');
const { initScheduledJobs } = require('./jobs/notificationJobs');

// Import routes
const authRoutes = require('../routes/auth');
const userRoutes = require('../routes/users');
const roomRoutes = require('../routes/rooms');
const inventoryRoutes = require('../routes/inventory');
const notificationRoutes = require('../routes/notifications');

// Import WebSocket service
const WebSocketService = require('./services/websocketService');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket service
const webSocketService = new WebSocketService(server);
app.set('webSocketService', webSocketService);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Not Found',
  });
});

const PORT = process.env.PORT || 3000;

// Start the server
const startServer = async () => {
  try {
    // Test database connection
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('Database connected successfully');
    
        // Initialize scheduled jobs
    initScheduledJobs();
    
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`WebSocket server is running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = { app, server };
