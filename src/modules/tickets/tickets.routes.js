const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const { validate, validateId, ticketSchemas } = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const {
  createTicket,
  getTicketCount,
  getTickets,
  updateTicket,
  getTicketById
} = require('./tickets.controller');

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
