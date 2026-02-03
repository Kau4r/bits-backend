const cron = require('node-cron');
const HeartbeatService = require('../services/heartbeatService');

/**
 * Check for offline computers and send alerts
 */
const checkOfflineComputers = async () => {
  try {
    console.log('[Heartbeat Monitor] Checking for offline computers...');

    const offlineCount = await HeartbeatService.checkOfflineComputers();

    console.log(`[Heartbeat Monitor] Marked ${offlineCount} computers as offline`);
  } catch (error) {
    console.error('[Heartbeat Monitor] Error checking offline computers:', error);
  }
};

/**
 * Initialize heartbeat monitoring job
 */
const initHeartbeatMonitor = () => {
  // Run every minute
  cron.schedule('* * * * *', checkOfflineComputers);

  console.log('[Heartbeat Monitor] Started - checking every minute');
};

module.exports = {
  initHeartbeatMonitor,
  checkOfflineComputers
};
