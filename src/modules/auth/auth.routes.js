const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const { login, logout, syncHtshadowUsers } = require('./auth.controller');

router.post('/login', login);
router.post('/logout', authenticateToken, logout);
router.post('/sync-htshadow', authenticateToken, authorize('ADMIN'), syncHtshadowUsers);

module.exports = router;
