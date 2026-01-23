const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../src/middleware/auth');
const AuditLogger = require('../src/utils/auditLogger');

const router = express.Router();
const prisma = new PrismaClient();

// Get all rooms
router.get('/', async (req, res) => {
  try {
    // Get all rooms (no booked rooms included)
    const rooms = await prisma.Room.findMany({ // Fixed casing
      orderBy: { Room_ID: 'asc' },
      include: {
        Schedule: {
          select: {
            Schedule_ID: true,
            Days: true,
            Start_Time: true,
            End_Time: true,
            Created_At: true,
            Updated_At: true
          }
        }
      }
    });

    res.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({
      error: 'Failed to fetch rooms',
      details: error.message
    });
  }
});


// Get room by ID
router.get('/:id', async (req, res) => {
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID', details: 'Room ID must be a positive number' });
  }

  try {
    const room = await prisma.Room.findUnique({
      where: { Room_ID: roomId },
      include: {
        Schedule: {
          select: {
            Schedule_ID: true,
            Days: true,
            Start_Time: true,
            End_Time: true,
            Created_At: true,
            Updated_At: true
          },
          orderBy: { Start_Time: 'asc' }
        },
        Booked_Rooms: true
      }
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found', details: `No room found with ID: ${roomId}` });
    }

    res.json(room);
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Failed to fetch room', details: error.message });
  }
});

// Create room
router.post('/', authenticateToken, async (req, res) => {
  // Permission Check
  if (!['ADMIN', 'LAB_HEAD'].includes(req.user.User_Role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const { Name, Capacity, Room_Type } = req.body;

  const errors = [];
  if (!Name?.trim()) errors.push('Name is required');
  if (!Capacity || isNaN(Capacity) || Capacity <= 0) errors.push('Valid capacity is required');
  if (Room_Type && !VALID_ROOM_TYPES.includes(Room_Type)) {
    errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
  }
  if (errors.length > 0) return res.status(400).json({ error: 'Validation Error', details: errors });

  try {
    const existingRoom = await prisma.Room.findFirst({
      where: { Name: { equals: Name.trim(), mode: 'insensitive' } }
    });

    if (existingRoom) {
      return res.status(409).json({ error: 'Room already exists', details: `A room named '${Name}' already exists`, existingRoomId: existingRoom.Room_ID });
    }

    const newRoom = await prisma.Room.create({
      data: { Name: Name.trim(), Capacity: parseInt(Capacity), Room_Type: Room_Type || 'LECTURE', Status: 'AVAILABLE' },
      select: { Room_ID: true, Name: true, Capacity: true, Room_Type: true, Status: true, Created_At: true, Updated_At: true }
    });

    // Audit Log
    await AuditLogger.log(
      req.user.User_ID,
      'ROOM_UPDATED', // Using ROOM_UPDATED as generic 'Room Mgmt' action, or create specific ROOM_CREATED if enum allows
      `Created room ${Name}`
    );

    res.status(201).json(newRoom);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room', details: error.message });
  }
});

// Update room
router.put('/:id', authenticateToken, async (req, res) => {
  if (!['ADMIN', 'LAB_HEAD'].includes(req.user.User_Role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID', details: 'Room ID must be a positive number' });

  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const { Name, Capacity, Room_Type, Status } = req.body;

  const updateData = {};
  const errors = [];

  if (Name !== undefined) {
    if (!Name.trim()) errors.push('Name must be a non-empty string');
    else updateData.Name = Name.trim();
  }
  if (Capacity !== undefined) {
    const cap = parseInt(Capacity);
    if (isNaN(cap) || cap <= 0) errors.push('Capacity must be a positive number');
    else updateData.Capacity = cap;
  }
  if (Room_Type !== undefined) {
    if (!VALID_ROOM_TYPES.includes(Room_Type)) errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
    else updateData.Room_Type = Room_Type;
  }
  if (Status !== undefined) updateData.Status = Status;

  if (errors.length > 0) return res.status(400).json({ error: 'Validation Error', details: errors });
  if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'Validation Error', details: 'No valid fields provided for update' });

  try {
    const updatedRoom = await prisma.Room.update({ where: { Room_ID: roomId }, data: updateData });

    // Determine Action
    let action = 'ROOM_UPDATED';
    if (Status === 'CLOSED') action = 'ROOM_CLOSED';
    if (Status === 'AVAILABLE' && req.body.Status) action = 'ROOM_OPENED';

    await AuditLogger.log(
      req.user.User_ID,
      action,
      `Updated room ${updatedRoom.Name}`
    );

    res.json({ message: 'Room updated successfully', room: updatedRoom });
  } catch (error) {
    console.error('Error updating room:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Room not found', details: error.message });
    res.status(500).json({ error: 'Failed to update room', details: error.message });
  }
});

// Delete room
router.delete('/:id', authenticateToken, async (req, res) => {
  if (!['ADMIN'].includes(req.user.User_Role)) { // Only Admin can delete rooms? Assuming strict
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID', details: 'Room ID must be a positive number' });

  try {
    const existingRoom = await prisma.Room.findUnique({ where: { Room_ID: roomId }, include: { Booked_Rooms: true, Schedule: true } });
    if (!existingRoom) return res.status(404).json({ error: 'Room not found' });

    const now = new Date();
    const hasActiveBookings = existingRoom.Booked_Rooms.some(b => new Date(b.End_Time) > now && b.Status !== 'CANCELLED');
    if (hasActiveBookings) return res.status(400).json({ error: 'Cannot delete room with active or future bookings' });

    await prisma.$transaction([
      prisma.Schedule.deleteMany({ where: { Room_ID: roomId } }),
      prisma.Booked_Room.deleteMany({ where: { Room_ID: roomId } }),
      prisma.Room.delete({ where: { Room_ID: roomId } })
    ]);

    await AuditLogger.log(
      req.user.User_ID,
      'ROOM_UPDATED',
      `Deleted room ${existingRoom.Name}`
    );

    res.json({ success: true, message: 'Room and related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Error deleting room', details: error.message });
  }
});

// Open room for student usage (LAB_HEAD/LAB_TECH only)
router.post('/:id/student-availability', authenticateToken, async (req, res) => {
  // Only LAB_HEAD, LAB_TECH, ADMIN can open rooms for student usage
  if (!['LAB_HEAD', 'LAB_TECH', 'ADMIN'].includes(req.user.User_Role)) {
    return res.status(403).json({ error: 'Unauthorized. Only LAB_HEAD, LAB_TECH, or ADMIN can set room availability.' });
  }

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const { startTime, endTime, notes } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime are required' });
  }

  const requestedStart = new Date(startTime);
  const requestedEnd = new Date(endTime);

  // Validate time range
  if (requestedStart >= requestedEnd) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  try {
    // Get the room with schedules
    const room = await prisma.Room.findUnique({
      where: { Room_ID: roomId },
      include: {
        Schedule: {
          where: { IsActive: true }
        }
      }
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Only LAB rooms can be opened for student usage
    if (room.Room_Type !== 'LAB') {
      return res.status(400).json({ error: 'Only LAB rooms can be opened for student usage' });
    }

    // Check for overlapping schedules
    const conflictingSchedule = room.Schedule.find(schedule => {
      const scheduleStart = new Date(schedule.Start_Time);
      const scheduleEnd = new Date(schedule.End_Time);
      // Check if time ranges overlap
      return (requestedStart < scheduleEnd && requestedEnd > scheduleStart);
    });

    if (conflictingSchedule) {
      const formatTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return res.status(409).json({
        error: 'Time conflict with existing schedule',
        details: `There is already a schedule from ${formatTime(conflictingSchedule.Start_Time)} to ${formatTime(conflictingSchedule.End_Time)}`,
        conflictingSchedule: {
          id: conflictingSchedule.Schedule_ID,
          startTime: conflictingSchedule.Start_Time,
          endTime: conflictingSchedule.End_Time
        }
      });
    }

    // Check for overlapping bookings
    const conflictingBooking = await prisma.Booked_Room.findFirst({
      where: {
        Room_ID: roomId,
        Status: { in: ['APPROVED', 'PENDING'] },
        Start_Time: { lt: requestedEnd },
        End_Time: { gt: requestedStart }
      },
      include: {
        User: { select: { First_Name: true, Last_Name: true } }
      }
    });

    if (conflictingBooking) {
      const formatTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return res.status(409).json({
        error: 'Time conflict with existing booking',
        details: `There is already a ${conflictingBooking.Status.toLowerCase()} booking from ${formatTime(conflictingBooking.Start_Time)} to ${formatTime(conflictingBooking.End_Time)}`,
        conflictingBooking: {
          id: conflictingBooking.Booked_Room_ID,
          status: conflictingBooking.Status,
          startTime: conflictingBooking.Start_Time,
          endTime: conflictingBooking.End_Time,
          bookedBy: conflictingBooking.User ? `${conflictingBooking.User.First_Name} ${conflictingBooking.User.Last_Name}` : 'Unknown'
        }
      });
    }

    // Format time display for notification message
    const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const formatDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Create 'APPROVED' booking to persist the availability
    const booking = await prisma.Booked_Room.create({
      data: {
        User_ID: req.user.User_ID,
        Room_ID: roomId,
        Start_Time: requestedStart,
        End_Time: requestedEnd,
        Status: 'APPROVED',
        Purpose: 'Student Usage',
        Notes: notes || 'Opened for student usage by Lab Head/Tech',
        Approved_By: req.user.User_ID,
        Created_At: new Date(),
        Updated_At: new Date()
      }
    });

    const message = `${room.Name} is now available for student use from ${formatTime(requestedStart)} to ${formatTime(requestedEnd)} on ${formatDate(requestedStart)}`;

    console.log('[RoomAvailability] Creating audit log for room availability:', { roomId, message });

    // Create audit log with student notification
    const auditLog = await AuditLogger.log({
      userId: req.user.User_ID,
      action: 'ROOM_AVAILABLE',
      logType: 'ROOM',
      isNotification: true,
      notifyRole: 'STUDENT', // Notify all students
      details: message,
      notificationData: {
        roomId: room.Room_ID,
        roomName: room.Name,
        startTime: requestedStart.toISOString(),
        endTime: requestedEnd.toISOString(),
        notes,
        bookingId: booking.Booked_Room_ID
      }
    });

    console.log('[RoomAvailability] Audit log created:', auditLog);

    res.status(201).json({
      success: true,
      message: 'Room availability set successfully. Students have been notified.',
      data: {
        roomId: room.Room_ID,
        roomName: room.Name,
        startTime: requestedStart.toISOString(),
        endTime: requestedEnd.toISOString(),
        auditLogId: auditLog?.Log_ID,
        bookingId: booking.Booked_Room_ID
      }
    });
  } catch (error) {
    console.error('Error setting room availability:', error);
    res.status(500).json({ error: 'Failed to set room availability', details: error.message });
  }
});

module.exports = router;

