const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const asyncHandler = require('../../utils/asyncHandler');
const { validate, bookingSchemas } = require('../../middleware/validate');
const {
    createBooking,
    getBookings,
    updateBooking,
    updateBookingStatus,
    getAvailableRooms,
    deleteBooking
} = require('./bookings.controller');

// Create a new room booking
router.post('/', authenticateToken, validate(bookingSchemas.create), asyncHandler(createBooking));

// Get all room bookings
router.get('/', authenticateToken, asyncHandler(getBookings));

// Update room booking details (time, room, purpose)
router.patch('/:id', authenticateToken, asyncHandler(updateBooking));

// Update room booking status
router.patch('/:id/status', authenticateToken, validate(bookingSchemas.updateStatus), asyncHandler(updateBookingStatus));

// Get available rooms for a time period
router.get('/available', authenticateToken, asyncHandler(getAvailableRooms));

// Delete a booking
router.delete('/:id', authenticateToken, asyncHandler(deleteBooking));

module.exports = router;
