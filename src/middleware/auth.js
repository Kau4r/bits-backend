const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { AppError } = require('./errorHandler');

// Validate JWT_SECRET at startup
if (!process.env.JWT_SECRET) {
  console.warn('[WARNING] JWT_SECRET is not set. Using fallback for development only.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const SALT_ROUNDS = 12;

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Allow token to be passed in query parameter for WebSocket connections
  const token = authHeader && authHeader.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      const message = err.name === 'TokenExpiredError'
        ? 'Token has expired'
        : 'Invalid token';
      return res.status(401).json({
        success: false,
        error: message
      });
    }

    try {
      // Fetch the user from the database to ensure they still exist and are active
      const dbUser = await prisma.user.findUnique({
        where: { User_ID: decoded.userId }
      });

      if (!dbUser) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check if user is active
      if (dbUser.Is_Active === false) {
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Attach user to request object (excluding password)
      const { Password, ...safeUser } = dbUser;
      req.user = safeUser;
      next();
    } catch (error) {
      console.error('[Auth] Error fetching user:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Server error during authentication'
      });
    }
  });
};

/**
 * Hash a password with bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare a password with a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Bcrypt hash
 * @returns {Promise<boolean>} Whether password matches
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

// Export the middleware functions
module.exports = {
  authenticateToken,
  hashPassword,
  comparePassword,
  JWT_SECRET
};
