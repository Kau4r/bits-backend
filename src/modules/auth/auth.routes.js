const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { login, logout } = require('./auth.controller');

router.post('/login', login);
router.post('/logout', authenticateToken, logout);

module.exports = router;
