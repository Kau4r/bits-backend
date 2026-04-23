const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const { validate, bookingSchemas } = require('../../middleware/validate');
const {
    createBooking,
    createBookingsWeekly,
    getBookings,
    updateBooking,
    updateBookingStatus,
    getAvailableRooms,
    deleteBooking,
    updateOccupancyStatus,
    getActiveQueues
} = require('./bookings.controller');

// Create a new room booking
router.post('/', authenticateToken, validate(bookingSchemas.create), asyncHandler(createBooking));

// Create a full week of bookings for a single room (lab-tech weekly student-usage schedule)
router.post(
    '/weekly',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    validate(bookingSchemas.createWeekly),
    asyncHandler(createBookingsWeekly)
);

// Get active Student-Usage queues (live right now). Any authenticated user.
router.get('/active-queues', authenticateToken, asyncHandler(getActiveQueues));

// Get all room bookings
router.get('/', authenticateToken, asyncHandler(getBookings));

// Update room booking details (time, room, purpose)
router.patch('/:id', authenticateToken, asyncHandler(updateBooking));

// Update room booking status
router.patch('/:id/status', authenticateToken, validate(bookingSchemas.updateStatus), asyncHandler(updateBookingStatus));

// Update queue occupancy status (OPEN / NEAR_FULL / FULL) — lab staff only.
router.patch(
    '/:id/occupancy-status',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    validate(bookingSchemas.updateOccupancyStatus),
    asyncHandler(updateOccupancyStatus)
);

// Get available rooms for a time period
router.get('/available', authenticateToken, asyncHandler(getAvailableRooms));

// Delete a booking
router.delete('/:id', authenticateToken, asyncHandler(deleteBooking));

module.exports = router;
