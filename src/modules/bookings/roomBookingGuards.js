const BOOKING_BLOCKING_ROOM_STATUSES = ['MAINTENANCE', 'CLOSED'];
const bookingBlockingRoomStatusSet = new Set(BOOKING_BLOCKING_ROOM_STATUSES);

const isRoomStatusBlockingBooking = (status) =>
  bookingBlockingRoomStatusSet.has(String(status || '').toUpperCase());

const buildRoomStatusBlockedResponse = (room) => ({
  success: false,
  error: 'Room is not available for booking',
  details: `Room status is currently ${room?.Status || 'UNKNOWN'}`
});

module.exports = {
  BOOKING_BLOCKING_ROOM_STATUSES,
  isRoomStatusBlockingBooking,
  buildRoomStatusBlockedResponse
};
