const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const AuditLogger = require('../utils/auditLogger');
const { AppError } = require('./errorHandler');

// Validate JWT_SECRET at startup
if (!process.env.JWT_SECRET) {
  console.warn('[WARNING] JWT_SECRET is not set. Using fallback for development only.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const SALT_ROUNDS = 12;

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Allow token to be passed in query parameter for SSE (EventSource)
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
 * Login endpoint handler
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const user = await prisma.user.findFirst({
      where: { Email: email.toLowerCase().trim() }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (user.Is_Active === false) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated. Please contact administrator.'
      });
    }

    // Password verification
    // Support both bcrypt hashed passwords and legacy plain text (for migration)
    let isPasswordValid = false;

    if (user.Password.startsWith('$2a$') || user.Password.startsWith('$2b$')) {
      // Password is bcrypt hashed
      isPasswordValid = await bcrypt.compare(password, user.Password);
    } else {
      // Legacy plain text password - compare and encourage migration
      isPasswordValid = user.Password === password;

      if (isPasswordValid) {
        // Auto-hash the password on successful login with plain text
        try {
          const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
          await prisma.user.update({
            where: { User_ID: user.User_ID },
            data: { Password: hashedPassword }
          });
          console.log(`[Auth] Migrated password to bcrypt for user ${user.User_ID}`);
        } catch (hashErr) {
          console.error('[Auth] Failed to migrate password:', hashErr.message);
          // Continue with login even if migration fails
        }
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const token = jwt.sign(
      { userId: user.User_ID, role: user.User_Role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log successful login to audit trail
    await AuditLogger.logAuth(
      user.User_ID,
      'USER_LOGIN',
      `User ${user.First_Name} ${user.Last_Name} logged in`,
      req
    );

    // Return user data without password
    const { Password, ...userData } = user;
    res.json({
      success: true,
      token,
      user: userData
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Server error during login'
    });
  }
};

/**
 * Logout endpoint handler (for audit logging)
 */
const logout = async (req, res) => {
  try {
    // Log logout action if user is authenticated
    if (req.user) {
      await AuditLogger.logAuth(
        req.user.User_ID,
        'USER_LOGOUT',
        `User ${req.user.First_Name} ${req.user.Last_Name} logged out`,
        req
      );
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('[Auth] Logout error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Server error during logout'
    });
  }
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
  login,
  logout,
  hashPassword,
  comparePassword,
  JWT_SECRET
};
