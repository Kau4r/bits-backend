const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const {
  createTicket,
  getTicketCount,
  getTickets,
  updateTicket,
  getTicketById
} = require('./tickets.controller');

// Create Ticket
router.post('/', authenticateToken, asyncHandler(createTicket));

// Get ticket count by status
router.get('/count', authenticateToken, asyncHandler(getTicketCount));

// Get all tickets (optionally filter by status)
router.get('/', authenticateToken, asyncHandler(getTickets));

// Update ticket (status, priority, category)
router.put('/:id', authenticateToken, asyncHandler(updateTicket));

// Get single ticket
router.get('/:id', authenticateToken, asyncHandler(getTicketById));

module.exports = router;
