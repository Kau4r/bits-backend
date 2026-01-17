const AuditService = require('../services/auditService');

// Map of routes to their corresponding audit log actions
const ROUTE_ACTIONS = {
  // Item management
  'POST /api/items': 'ITEM_CREATE',
  'PUT /api/items/': 'ITEM_UPDATE',
  'DELETE /api/items/': 'ITEM_DELETE',
  
  // Borrowing system
  'POST /api/borrow': 'BORROW_CREATE',
  'PUT /api/borrow/': 'BORROW_UPDATE',
  'DELETE /api/borrow/': 'BORROW_DELETE',
  'POST /api/borrow/return/': 'BORROW_RETURN',
  
  // Room bookings
  'POST /api/bookings': 'BOOKING_CREATE',
  'PUT /api/bookings/': 'BOOKING_UPDATE',
  'DELETE /api/bookings/': 'BOOKING_CANCEL',
  
  // Tickets
  'POST /api/tickets': 'TICKET_CREATE',
  'PUT /api/tickets/': 'TICKET_UPDATE',
  'DELETE /api/tickets/': 'TICKET_DELETE',
};

// Get the appropriate action for a request
const getActionForRequest = (method, path) => {
  const basePath = path.split('/').slice(0, 4).join('/');
  const key = `${method} ${basePath}`;
  return ROUTE_ACTIONS[key] || null;
};

// Log API requests
const logRequest = async (req, res, next) => {
  // Skip if this is a health check or metrics endpoint
  if (req.path === '/health' || req.path === '/metrics') {
    return next();
  }

  const startTime = Date.now();
  const originalJson = res.json;
  const originalSend = res.send;
  let responseBody = null;

  // Override response methods to capture the response
  res.json = function (body) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  res.send = function (body) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Log the request when the response finishes
  res.on('finish', async () => {
    try {
      const action = getActionForRequest(req.method, req.path);
      if (!action) return; // Skip if no matching action

      const userId = req.user?.User_ID || null;
      const resourceId = req.params.id || (responseBody?.id ? String(responseBody.id) : null);
      
      let details = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: Date.now() - startTime,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      };

      // Add request body for non-GET requests (except sensitive data)
      if (req.method !== 'GET' && req.body) {
        const { password, token, refreshToken, ...safeBody } = req.body;
        details.requestBody = safeBody;
      }

      // Log based on the action type
      const actionType = action.split('_')[0];
      const actionVerb = action.split('_').slice(1).join('_');

      switch (actionType) {
        case 'ITEM':
          await AuditService.logItemEvent(userId, actionVerb, resourceId, details);
          break;
          
        case 'BORROW':
          await AuditService.logBorrowingEvent(userId, actionVerb, resourceId, details);
          break;
          
        case 'BOOKING':
          await AuditService.logBookingEvent(userId, actionVerb, resourceId, details);
          break;
          
        case 'TICKET':
          await AuditService.logTicketEvent(userId, actionVerb, resourceId, details);
          break;
          
        default:
          await AuditService._createLog({
            userId,
            action,
            details: JSON.stringify(details),
            logType: 'SYSTEM',
            relatedId: resourceId,
            relatedType: actionType
          });
      }
    } catch (error) {
      console.error('Error logging request:', error);
      // Don't fail the request if logging fails
    }
  });

  next();
};

module.exports = logRequest;
