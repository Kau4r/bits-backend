/**
 * Test-only Express app import.
 * WebSocket is mocked via jest.config.js moduleNameMapper.
 */
const { app } = require('../src/server');

module.exports = { app };
