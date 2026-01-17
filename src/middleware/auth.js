const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const AuditLogger = require('../utils/auditLogger');

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Allow token to be passed in query parameter for SSE (EventSource)
  const token = authHeader && authHeader.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', async (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    try {
      // Fetch the user from the database to ensure they still exist
      const dbUser = await prisma.user.findUnique({
        where: { User_ID: user.userId }
      });

      if (!dbUser) {
        return res.status(403).json({
          success: false,
          error: 'User not found'
        });
      }

      // Attach user to request object
      req.user = dbUser;
      next();
    } catch (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error during authentication'
      });
    }
  });
};

// Login endpoint
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await prisma.user.findFirst({ where: { Email: email } });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    if (user.Is_Active === false) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    console.log('User from DB:', user);

    // if password column is capitalized
    if (user.Password !== password) return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.User_ID }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1h' });

    // Log successful login to audit trail
    await AuditLogger.logAuth(user.User_ID, 'USER_LOGIN', `User ${user.First_Name} ${user.Last_Name} logged in`, req);

    const { Password, ...userData } = user;
    res.json({ token, user: userData });
  } catch (err) {
    console.error('Login route error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Logout endpoint (for audit logging)
const logout = async (req, res) => {
  try {
    // Log logout action if user is authenticated
    if (req.user) {
      await AuditLogger.logAuth(req.user.User_ID, 'USER_LOGOUT', `User ${req.user.First_Name} ${req.user.Last_Name} logged out`, req);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout route error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Export the middleware functions
module.exports = {
  authenticateToken,
  login,
  logout
};
