const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize, ROLES } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
    register,
    sendHeartbeat,
    getStatus,
    getComputerHistory,
    endSession
} = require('./heartbeat.controller');

// Auto-detect computer via MAC address
router.post('/register', authenticateToken, asyncHandler(register));

// Receive heartbeat signal
router.post('/', authenticateToken, asyncHandler(sendHeartbeat));

// Get status summary
router.get('/status',
    authenticateToken,
    authorize(ROLES.LAB_TECH, ROLES.LAB_HEAD, ROLES.ADMIN),
    asyncHandler(getStatus)
);

// Get detailed computer history
router.get('/computer/:id',
    authenticateToken,
    authorize(ROLES.LAB_TECH, ROLES.LAB_HEAD, ROLES.ADMIN),
    asyncHandler(getComputerHistory)
);

// End session
router.delete('/session/:sessionId', authenticateToken, asyncHandler(endSession));

module.exports = router;
