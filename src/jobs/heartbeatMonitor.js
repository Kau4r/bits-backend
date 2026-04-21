const cron = require('node-cron');
const HeartbeatService = require('../services/heartbeatService');

/**
 * Check for offline computers and send alerts
 */
const checkOfflineComputers = async () => {
  try {
    console.log('[Workstation Status Job] Checking workstation records...');

    const offlineCount = await HeartbeatService.checkOfflineComputers();

    console.log(`[Workstation Status Job] Updated ${offlineCount} workstation records`);
  } catch (error) {
    console.error('[Workstation Status Job] Error updating workstation records:', error);
  }
};

/**
 * Initialize workstation status refresh job
 */
const initHeartbeatMonitor = () => {
  // Run every minute
  cron.schedule('* * * * *', checkOfflineComputers);

  console.log('[Workstation Status Job] Started - checking every minute');
};

module.exports = {
  initHeartbeatMonitor,
  checkOfflineComputers
};
