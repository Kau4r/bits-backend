const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Middleware to check if user is authenticated and has a valid token
 */
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await prisma.user.findUnique({
      where: { User_ID: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Middleware to check if user has required role(s)
 */
const checkUserRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (roles.length && !roles.includes(req.user.User_Type)) {
      return res.status(403).json({ 
        error: `Access denied. Required role(s): ${roles.join(', ')}` 
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  checkUserRole,
  isAdmin: checkUserRole(['ADMIN']),
  isLabTech: checkUserRole(['LAB_TECH']),
  isAdminOrLabTech: checkUserRole(['ADMIN', 'LAB_TECH']),
  isFaculty: checkUserRole(['FACULTY']),
  isStudent: checkUserRole(['STUDENT']),
};
