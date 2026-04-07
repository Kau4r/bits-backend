const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fs = require('fs');
const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const HTSHADOW_PATH = process.env.HTSHADOW_PATH || '/etc/htshadow';

/**
 * Verify password against the htshadow file
 * @param {string} username - Username to look up
 * @param {string} password - Plain text password to verify
 * @returns {Promise<boolean>} Whether password matches
 */
const verifyHtshadowPassword = async (username, password) => {
  try {
    const data = fs.readFileSync(HTSHADOW_PATH, 'utf-8');
    const line = data.split('\n').find(l => l.startsWith(username + ':'));
    if (!line) return false;

    const hash = line.split(':')[1].trim();
    // Normalize $2y$ (PHP bcrypt) to $2b$ (Node bcrypt)
    const normalized = hash.replace(/^\$2y\$/, '$2b$');
    return bcrypt.compare(password, normalized);
  } catch (err) {
    console.error('[Auth] Error reading htshadow file:', err.message);
    return false;
  }
};

/**
 * Login endpoint handler
 * Authenticates against htshadow file first, falls back to DB password
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    // Look up user by Username in DB
    const user = await prisma.user.findFirst({
      where: { Username: username.trim() }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    // Check if user is active
    if (user.Is_Active === false) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated. Please contact administrator.'
      });
    }

    // Step 1: Try to verify against htshadow file
    let isPasswordValid = await verifyHtshadowPassword(username.trim(), password);

    // Step 2: Fallback to DB password (for admin or users not in htshadow)
    if (!isPasswordValid && user.Password) {
      if (user.Password.startsWith('$2a$') || user.Password.startsWith('$2b$')) {
        isPasswordValid = await bcrypt.compare(password, user.Password);
      } else {
        isPasswordValid = user.Password === password;
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
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
      data: { token, user: userData }
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
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (err) {
    console.error('[Auth] Logout error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Server error during logout'
    });
  }
};

/**
 * Sync users from htshadow file into the database
 * Creates DB records for usernames found in htshadow that don't already exist
 */
const syncHtshadowUsers = async (req, res) => {
  try {
    const data = fs.readFileSync(HTSHADOW_PATH, 'utf-8');
    const lines = data.split('\n').filter(l => l.includes(':'));

    const results = { created: [], skipped: [] };

    for (const line of lines) {
      const username = line.split(':')[0].trim();
      if (!username) continue;

      // Check if user with this username already exists
      const existing = await prisma.user.findFirst({
        where: { Username: username }
      });

      if (existing) {
        results.skipped.push(username);
        continue;
      }

      // Create a new user with default values
      const newUser = await prisma.user.create({
        data: {
          Username: username,
          First_Name: username,
          Middle_Name: '',
          Last_Name: '',
          Email: `${username}@placeholder.local`,
          Password: '',
          User_Role: 'STUDENT',
          Is_Active: true
        }
      });

      results.created.push({ User_ID: newUser.User_ID, Username: username });
    }

    res.json({
      success: true,
      data: {
        message: `Synced htshadow: ${results.created.length} created, ${results.skipped.length} skipped`,
        ...results
      }
    });
  } catch (err) {
    console.error('[Auth] Sync htshadow error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to sync htshadow users: ' + err.message
    });
  }
};

module.exports = { login, logout, syncHtshadowUsers };
