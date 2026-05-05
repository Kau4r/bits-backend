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

// Atomic per-name-ID and per-IP-room cooldown for public reports.
// Stacking two express-rate-limit instances would double-count: a request
// rejected by the second limiter still consumes the first limiter's slot.
// Instead, peek both keys, reject on the first hit, and only commit
// timestamps when ALL applicable rules pass.
const PUBLIC_TICKET_COOLDOWN_MS = 10 * 60 * 1000;
const publicTicketCooldowns = new Map(); // key -> expiresAt ms

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of publicTicketCooldowns) if (v <= now) publicTicketCooldowns.delete(k);
}, 60_000).unref();

const publicTicketCooldownGuard = (req, res, next) => {
  const identifier = (req.body?.reporterIdentifier || '').trim().toLowerCase();
  const roomId = req.body?.roomId;
  const rules = [];
  if (identifier) rules.push({
    key: `reporter:${identifier}`,
    message: 'A report from this name + ID was just submitted. Please wait a few minutes before reporting again.'
  });
  if (roomId != null) rules.push({
    key: `iproom:${req.ip}:${roomId}`,
    message: 'A report for this room from your device was just submitted. Please wait a few minutes before reporting it again.'
  });

  const now = Date.now();
  for (const { key, message } of rules) {
    const expires = publicTicketCooldowns.get(key);
    if (expires && expires > now) {
      res.set('Retry-After', Math.ceil((expires - now) / 1000));
      return res.status(429).json({ success: false, error: message });
    }
  }
  for (const { key } of rules) publicTicketCooldowns.set(key, now + PUBLIC_TICKET_COOLDOWN_MS);
  next();
};

// Public (unauthenticated) ticket submission — MUST be before authenticateToken routes.
router.post(
  '/public',
  publicTicketLimiter,
  validate(ticketSchemas.createPublic),
  publicTicketCooldownGuard,
  asyncHandler(createPublicTicket)
);

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
