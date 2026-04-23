const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authorize } = require('../../middleware/authorize');
const asyncHandler = require('../../utils/asyncHandler');
const {
  getRooms,
  getRoomById,
  getOpenedLabs,
  createRoom,
  updateRoom,
  deleteRoom,
  setStudentAvailability,
  getRoomAuditStatus,
  getPublicOpenedLabs,
  getPublicLectureRooms,
  getPublicRoomSchedule7Day,
  getPublicRooms,
} = require('./rooms.controller');

// Public (unauthenticated) routes for the student landing page. These must be
// mounted BEFORE any authenticateToken-protected routes so they stay open.
router.get('/public/opened-labs', asyncHandler(getPublicOpenedLabs));
router.get('/public/lecture-rooms', asyncHandler(getPublicLectureRooms));
router.get('/public/:roomId/schedule-7day', asyncHandler(getPublicRoomSchedule7Day));
router.get('/public', asyncHandler(getPublicRooms));

router.get('/', asyncHandler(getRooms));
router.get('/opened-labs', authenticateToken, authorize('STUDENT', 'LAB_HEAD', 'LAB_TECH', 'ADMIN'), asyncHandler(getOpenedLabs));
router.get('/:id/audit-status', authenticateToken, authorize('LAB_HEAD', 'LAB_TECH', 'ADMIN'), asyncHandler(getRoomAuditStatus));
router.get('/:id', asyncHandler(getRoomById));
router.post('/', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(createRoom));
router.put('/:id', authenticateToken, authorize('ADMIN', 'LAB_HEAD'), asyncHandler(updateRoom));
router.delete('/:id', authenticateToken, authorize('ADMIN'), asyncHandler(deleteRoom));
router.post('/:id/student-availability', authenticateToken, authorize('LAB_HEAD', 'LAB_TECH', 'ADMIN'), asyncHandler(setStudentAvailability));

module.exports = router;
