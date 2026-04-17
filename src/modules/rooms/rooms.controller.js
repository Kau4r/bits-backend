const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');
const NotificationManager = require('../../services/notificationManager');
const { findScheduleConflict, formatScheduleTime } = require('../../utils/scheduleConflict');

const roomNameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
  ignorePunctuation: true,
});

const sortRoomsForDisplay = (rooms) => {
  return [...rooms].sort((a, b) => {
    const nameCompare = roomNameCollator.compare((a.Name || '').trim(), (b.Name || '').trim());
    if (nameCompare !== 0) return nameCompare;
    return (a.Room_ID || 0) - (b.Room_ID || 0);
  });
};

// Get all rooms
const getRooms = async (req, res) => {
  try {
    // Get all rooms (no booked rooms included)
    const rooms = await prisma.Room.findMany({ // Fixed casing
      orderBy: { Room_ID: 'asc' },
      include: {
        Schedule: {
          select: {
            Schedule_ID: true,
            Days: true,
            Title: true,
            Schedule_Type: true,
            Start_Time: true,
            End_Time: true,
            Created_At: true,
            Updated_At: true
          }
        }
      }
    });

    res.json({ success: true, data: sortRoomsForDisplay(rooms) });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
};

// Get room by ID
const getRoomById = async (req, res) => {
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid room ID' });
  }

  try {
    const room = await prisma.Room.findUnique({
      where: { Room_ID: roomId },
      include: {
        Schedule: {
          select: {
            Schedule_ID: true,
            Days: true,
            Title: true,
            Schedule_Type: true,
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
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    res.json({ success: true, data: room });
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch room' });
  }
};

// Get lab rooms currently or next opened for student usage.
const getOpenedLabs = async (req, res) => {
  try {
    const now = new Date();

    const rooms = await prisma.Room.findMany({
      where: {
        Room_Type: 'LAB',
        Status: { notIn: ['MAINTENANCE', 'CLOSED'] },
        Booked_Rooms: {
          some: {
            Status: 'APPROVED',
            Purpose: 'Student Usage',
            End_Time: { gt: now }
          }
        }
      },
      include: {
        Booked_Rooms: {
          where: {
            Status: 'APPROVED',
            Purpose: 'Student Usage',
            End_Time: { gt: now }
          },
          include: {
            User: {
              select: {
                User_ID: true,
                First_Name: true,
                Last_Name: true
              }
            }
          },
          orderBy: {
            Start_Time: 'asc'
          }
        }
      },
      orderBy: {
        Name: 'asc'
      }
    });

    const openedLabs = rooms
      .map(room => {
        const nextBooking = room.Booked_Rooms[0];
        return {
          ...room,
          Opened_At: nextBooking?.Created_At || nextBooking?.Start_Time || null,
          Opened_By_User: nextBooking?.User || null
        };
      })
      .sort((a, b) => {
        const aStart = a.Booked_Rooms[0]?.Start_Time ? new Date(a.Booked_Rooms[0].Start_Time).getTime() : 0;
        const bStart = b.Booked_Rooms[0]?.Start_Time ? new Date(b.Booked_Rooms[0].Start_Time).getTime() : 0;
        return aStart - bStart;
      });

    res.json({ success: true, data: openedLabs });
  } catch (error) {
    console.error('Error fetching opened labs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch opened laboratories' });
  }
};

// Create room
const createRoom = async (req, res) => {

  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const VALID_LAB_TYPES = ['WINDOWS', 'MAC'];
  const { Name, Capacity, Room_Type, Lab_Type } = req.body;

  const errors = [];
  if (!Name?.trim()) errors.push('Name is required');
  if (!Capacity || isNaN(Capacity) || Capacity <= 0) errors.push('Valid capacity is required');
  if (Room_Type && !VALID_ROOM_TYPES.includes(Room_Type)) {
    errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
  }
  if (Room_Type === 'LAB') {
    if (!Lab_Type || !VALID_LAB_TYPES.includes(Lab_Type)) {
      errors.push('Lab_Type is required for LAB rooms and must be WINDOWS or MAC');
    }
  }
  if (errors.length > 0) return res.status(400).json({ success: false, error: 'Validation Error', meta: { details: errors } });

  try {
    const existingRoom = await prisma.Room.findFirst({
      where: { Name: { equals: Name.trim(), mode: 'insensitive' } }
    });

    if (existingRoom) {
      return res.status(409).json({ success: false, error: `A room named '${Name}' already exists` });
    }

    const newRoom = await prisma.Room.create({
      data: { Name: Name.trim(), Capacity: parseInt(Capacity), Room_Type: Room_Type || 'LECTURE', Lab_Type: Room_Type === 'LAB' ? Lab_Type : null, Status: 'AVAILABLE' },
      select: { Room_ID: true, Name: true, Capacity: true, Room_Type: true, Lab_Type: true, Status: true, Created_At: true, Updated_At: true }
    });

    // Audit Log
    await AuditLogger.log(
      req.user.User_ID,
      'ROOM_UPDATED', // Using ROOM_UPDATED as generic 'Room Mgmt' action, or create specific ROOM_CREATED if enum allows
      `Created room ${Name}`
    );

    res.status(201).json({ success: true, data: newRoom });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ success: false, error: 'Failed to create room' });
  }
};

// Update room
const updateRoom = async (req, res) => {

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ success: false, error: 'Invalid room ID' });

  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const VALID_LAB_TYPES = ['WINDOWS', 'MAC'];
  const { Name, Capacity, Room_Type, Status, Lab_Type } = req.body;

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

  // Handle Lab_Type
  if (Lab_Type !== undefined) {
    if (Lab_Type !== null && !VALID_LAB_TYPES.includes(Lab_Type)) {
      errors.push('Lab_Type must be WINDOWS, MAC, or null');
    } else {
      updateData.Lab_Type = Lab_Type;
    }
  }

  if (errors.length > 0) return res.status(400).json({ success: false, error: 'Validation Error', meta: { details: errors } });
  if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, error: 'No valid fields provided for update' });

  try {
    // Fetch existing room for merge-based validation
    const existingRoom = await prisma.Room.findUnique({ where: { Room_ID: roomId } });
    if (!existingRoom) return res.status(404).json({ success: false, error: 'Room not found' });

    // Determine effective post-update state
    const effectiveRoomType = updateData.Room_Type ?? existingRoom.Room_Type;

    // If transitioning INTO LAB and no Lab_Type provided, require it
    if (effectiveRoomType === 'LAB' && existingRoom.Room_Type !== 'LAB' && !updateData.Lab_Type && !existingRoom.Lab_Type) {
      return res.status(400).json({ success: false, error: 'Lab_Type is required when changing Room_Type to LAB' });
    }

    // If transitioning AWAY from LAB, clear Lab_Type
    if (effectiveRoomType !== 'LAB') {
      updateData.Lab_Type = null;
    }

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

    res.json({ success: true, data: { message: 'Room updated successfully', room: updatedRoom } });
  } catch (error) {
    console.error('Error updating room:', error);
    if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Room not found' });
    res.status(500).json({ success: false, error: 'Failed to update room' });
  }
};

// Delete room
const deleteRoom = async (req, res) => {

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ success: false, error: 'Invalid room ID' });

  try {
    const existingRoom = await prisma.Room.findUnique({ where: { Room_ID: roomId }, include: { Booked_Rooms: true, Schedule: true } });
    if (!existingRoom) return res.status(404).json({ success: false, error: 'Room not found' });

    const now = new Date();
    const hasActiveBookings = existingRoom.Booked_Rooms.some(b => new Date(b.End_Time) > now && b.Status !== 'CANCELLED');
    if (hasActiveBookings) return res.status(400).json({ success: false, error: 'Cannot delete room with active or future bookings' });

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

    res.json({ success: true, data: { message: 'Room and related data deleted successfully' } });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ success: false, error: 'Error deleting room' });
  }
};

// Open room for student usage (LAB_HEAD/LAB_TECH only)
const setStudentAvailability = async (req, res) => {

  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid room ID' });
  }

  const { startTime, endTime, notes } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ success: false, error: 'startTime and endTime are required' });
  }

  const requestedStart = new Date(startTime);
  const requestedEnd = new Date(endTime);

  // Validate time range
  if (requestedStart >= requestedEnd) {
    return res.status(400).json({ success: false, error: 'End time must be after start time' });
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
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Only LAB rooms can be opened for student usage
    if (room.Room_Type !== 'LAB') {
      return res.status(400).json({ success: false, error: 'Only LAB rooms can be opened for student usage' });
    }

    // Check for overlapping recurring class schedules
    const conflictingSchedule = findScheduleConflict(room.Schedule, requestedStart, requestedEnd);

    if (conflictingSchedule) {
      return res.status(409).json({
        success: false,
        error: `Time conflict with existing schedule from ${formatScheduleTime(conflictingSchedule.Start_Time)} to ${formatScheduleTime(conflictingSchedule.End_Time)}`
      });
    }

    // Approved bookings are firm conflicts. Pending bookings are lower priority
    // than the computer-use queue and will be rejected below if they overlap.
    const conflictingApprovedBooking = await prisma.Booked_Room.findFirst({
      where: {
        Room_ID: roomId,
        Status: 'APPROVED',
        Start_Time: { lt: requestedEnd },
        End_Time: { gt: requestedStart }
      },
      include: {
        User: { select: { First_Name: true, Last_Name: true } }
      }
    });

    if (conflictingApprovedBooking) {
      const formatTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return res.status(409).json({
        success: false,
        error: `Time conflict with existing approved booking from ${formatTime(conflictingApprovedBooking.Start_Time)} to ${formatTime(conflictingApprovedBooking.End_Time)}`
      });
    }

    const conflictingPendingBookings = await prisma.Booked_Room.findMany({
      where: {
        Room_ID: roomId,
        Status: 'PENDING',
        Start_Time: { lt: requestedEnd },
        End_Time: { gt: requestedStart }
      },
      include: {
        Room: true,
        User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } }
      }
    });

    // Format time display for notification message
    const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const formatDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const autoRejectNote = `Automatically rejected because ${room.Name} was opened for computer use queue from ${formatTime(requestedStart)} to ${formatTime(requestedEnd)} on ${formatDate(requestedStart)}.`;

    const { booking, rejectedBookings } = await prisma.$transaction(async (tx) => {
      const rejectedBookings = await Promise.all(conflictingPendingBookings.map((pendingBooking) =>
        tx.Booked_Room.update({
          where: { Booked_Room_ID: pendingBooking.Booked_Room_ID },
          data: {
            Status: 'REJECTED',
            Notes: pendingBooking.Notes
              ? `${pendingBooking.Notes}\n${autoRejectNote}`
              : autoRejectNote,
            Updated_At: new Date()
          },
          include: {
            Room: true,
            User: { select: { User_ID: true, First_Name: true, Last_Name: true, Email: true } },
            Approver: {
              select: {
                User_ID: true,
                First_Name: true,
                Last_Name: true,
                User_Role: true
              }
            }
          }
        })
      ));

      // Create 'APPROVED' booking to persist the availability
      const booking = await tx.Booked_Room.create({
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

      return { booking, rejectedBookings };
    });

    for (const rejectedBooking of rejectedBookings) {
      const rejectMessage = `Your booking for ${room.Name} was rejected because the room was opened for computer use queue.`;

      await AuditLogger.logBooking(
        req.user.User_ID,
        'BOOKING_REJECTED',
        rejectedBooking.Booked_Room_ID,
        rejectMessage,
        null,
        rejectedBooking.User_ID
      );

      NotificationManager.send(rejectedBooking.User_ID, {
        type: 'BOOKING_REJECTED',
        category: 'BOOKING_UPDATE',
        timestamp: new Date().toISOString(),
        message: rejectMessage,
        booking: {
          id: rejectedBooking.Booked_Room_ID,
          roomId: rejectedBooking.Room_ID,
          status: rejectedBooking.Status,
          startTime: rejectedBooking.Start_Time,
          endTime: rejectedBooking.End_Time
        }
      });
    }

    if (rejectedBookings.length > 0) {
      await NotificationManager.broadcastBookingEvent('BOOKING_REJECTED', rejectedBookings[0], ['LAB_HEAD', 'LAB_TECH']);
    }

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
      data: {
        message: 'Room availability set successfully. Students have been notified.',
        roomId: room.Room_ID,
        roomName: room.Name,
        startTime: requestedStart.toISOString(),
        endTime: requestedEnd.toISOString(),
        auditLogId: auditLog?.Log_ID,
        bookingId: booking.Booked_Room_ID,
        rejectedBookings: rejectedBookings.map((rejectedBooking) => ({
          id: rejectedBooking.Booked_Room_ID,
          userId: rejectedBooking.User_ID,
          startTime: rejectedBooking.Start_Time,
          endTime: rejectedBooking.End_Time
        }))
      }
    });
  } catch (error) {
    console.error('Error setting room availability:', error);
    res.status(500).json({ success: false, error: 'Failed to set room availability' });
  }
};

module.exports = {
  getRooms,
  getRoomById,
  getOpenedLabs,
  createRoom,
  updateRoom,
  deleteRoom,
  setStudentAvailability
};
