const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Generate a test JWT token for a given user
 */
function generateTestToken(user) {
  return jwt.sign(
    { userId: user.User_ID, role: user.User_Role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Create auth header object for supertest
 */
function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { generateTestToken, authHeader };
