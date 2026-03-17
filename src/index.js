require('dotenv').config();

const { server } = require('./server');

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
