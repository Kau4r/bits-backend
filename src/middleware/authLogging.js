const jwt = require('jsonwebtoken');
const AuditService = require('../services/auditService');

// Middleware to log successful logins
const logLogin = async (req, res, next) => {
  // Save the original send function
  const originalSend = res.send;
  let responseSent = false;

  // Override the send function to capture the response
  res.send = function (body) {
    responseSent = true;
    res.send = originalSend; // Reset to avoid double-sending
    
    // Only log if this is a successful login
    if (res.statusCode === 200 && req.path.endsWith('/login') && req.method === 'POST') {
      try {
        const response = JSON.parse(body);
        if (response.token) {
          const decoded = jwt.verify(response.token, process.env.JWT_SECRET);
          AuditService.logAuthEvent(
            decoded.User_ID, 
            'LOGIN_SUCCESS', 
            { ip: req.ip, userAgent: req.get('user-agent') }
          );
        }
      } catch (error) {
        console.error('Error logging login:', error);
      }
    }
    
    return res.send(body);
  };

  next();
};

// Middleware to log failed login attempts
const logFailedLogin = async (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function (body) {
    // Only log if this is a failed login attempt
    if (res.statusCode === 401 && req.path.endsWith('/login') && req.method === 'POST') {
      AuditService.logAuthEvent(
        null, 
        'LOGIN_FAILED', 
        { 
          email: req.body.email, 
          ip: req.ip, 
          userAgent: req.get('user-agent'),
          reason: body.message || 'Invalid credentials'
        }
      );
    }
    
    return originalJson.call(this, body);
  };

  next();
};

// Middleware to log logouts
const logLogout = async (req, res, next) => {
  if (req.path.endsWith('/logout') && req.method === 'POST') {
    // Log before sending the response
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await AuditService.logAuthEvent(
          decoded.User_ID,
          'LOGOUT',
          { ip: req.ip, userAgent: req.get('user-agent') }
        );
      } catch (error) {
        console.error('Error logging logout:', error);
      }
    }
  }
  next();
};

module.exports = {
  logLogin,
  logFailedLogin,
  logLogout
};
