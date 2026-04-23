const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const { validate, validateId, ticketSchemas } = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const {
  createTicket,
  getTicketCount,
  getTickets,
  updateTicket,
  getTicketById,
  createPublicTicket,
} = require('./tickets.controller');

// Rate limiter for the public report endpoint: 10 requests per 15 minutes per IP.
const publicTicketLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many reports from your device — please wait a bit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public (unauthenticated) ticket submission — MUST be before authenticateToken routes.
router.post('/public', publicTicketLimiter, validate(ticketSchemas.createPublic), asyncHandler(createPublicTicket));

// Create Ticket
router.post('/', authenticateToken, validate(ticketSchemas.create), asyncHandler(createTicket));

// Get ticket count by status
router.get('/count', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(getTicketCount));

// Get all tickets (optionally filter by status)
router.get('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), asyncHandler(getTickets));

// Update ticket (status, priority, category)
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD', 'LAB_TECH'), validateId, validate(ticketSchemas.update), asyncHandler(updateTicket));

// Get single ticket
router.get('/:id', authenticateToken, validateId, asyncHandler(getTicketById));

module.exports = router;
