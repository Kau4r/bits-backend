const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    // Get all rooms
    const rooms = await prisma.room.findMany({
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
        },
        Booked_Room: {
          where: {
            End_Time: { gte: new Date() },
            Status: { not: 'CANCELLED' }
          },
          select: {
            Booked_Room_ID: true,
            Room_ID: true,
            User_ID: true,
            Start_Time: true,
            End_Time: true,
            Status: true,
            Created_At: true,
            Updated_At: true
          },
          orderBy: { Start_Time: 'asc' }
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
    return res.status(400).json({ 
      error: 'Invalid room ID',
      details: 'Room ID must be a positive number'
    });
  }

  try {
    const room = await prisma.room.findUnique({
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
        }
      }
    });

    if (!room) {
      return res.status(404).json({
        error: 'Room not found',
        details: `No room found with ID: ${roomId}`
      });
    }

    res.json(room);
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({
      error: 'Failed to fetch room',
      details: error.message
    });
  }
});

router.post('/', async (req, res) => {
  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const { Name, Capacity, Room_Type } = req.body;
  
  // Input validation
  const errors = [];
  if (!Name?.trim()) errors.push('Name is required');
  if (!Capacity || isNaN(Capacity) || Capacity <= 0) errors.push('Valid capacity is required');
  if (Room_Type && !VALID_ROOM_TYPES.includes(Room_Type)) {
    errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation Error', details: errors });
  }
  
  try {
    // Check for duplicate room name (case-insensitive)
    const existingRoom = await prisma.room.findFirst({
      where: {
        Name: {
          equals: Name.trim(),
          mode: 'insensitive'
        }
      }
    });
    
    if (existingRoom) {
      return res.status(409).json({
        error: 'Room already exists',
        details: `A room named '${Name}' already exists`,
        existingRoomId: existingRoom.Room_ID
      });
    }
    
    const newRoom = await prisma.room.create({
      data: {
        Name: Name.trim(),
        Capacity: parseInt(Capacity),
        Room_Type: Room_Type || 'LECTURE',
        Status: 'AVAILABLE'
      },
      select: {
        Room_ID: true,
        Name: true,
        Capacity: true,
        Room_Type: true,
        Status: true,
        Created_At: true,
        Updated_At: true
      }
    });
    
    // Log the creation
    try {
      await prisma.audit_Log.create({
        data: {
          Log_Type: 'SYSTEM',
          Action: 'ROOM_CREATED',
          Details: JSON.stringify({
            roomId: newRoom.Room_ID,
            roomName: newRoom.Name
          })
        }
      });
    } catch (auditError) {
      console.error('Audit log error:', auditError);
    }
    
    res.status(201).json(newRoom);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({
      error: 'Failed to create room',
      details: error.message,
      ...(process.env.NODE_ENV === 'development' && {
        code: error.code,
        meta: error.meta
      })
    });
  }
});

// Update room by ID
router.put('/:id', async (req, res) => {
  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  
  const validateRoomId = (id) => {
    const roomId = parseInt(id, 10);
    if (isNaN(roomId) || roomId <= 0) {
      return { valid: false, error: 'Room ID must be a positive number' };
    }
    return { valid: true, roomId };
  };
  
  const { valid, roomId, error } = validateRoomId(req.params.id);
  if (!valid) {
    return res.status(400).json({ 
      error: 'Invalid room ID',
      details: error
    });
  }

  try {
    const { Name, Capacity, Room_Type, Status } = req.body;
    
    // Check if room exists
    const existingRoom = await prisma.room.findUnique({
      where: { Room_ID: roomId },
    });
    
    if (!existingRoom) {
      return res.status(404).json({ 
        error: 'Room not found',
        details: `No room found with ID: ${roomId}`
      });
    }
    
    // Prepare update data
    const updateData = {};
    const errors = [];
    
    // Validate and update Name if provided
    if (Name !== undefined) {
      if (typeof Name !== 'string' || Name.trim() === '') {
        errors.push('Name must be a non-empty string');
      } else {
        updateData.Name = Name.trim();
      }
    }
    
    // Validate and update Capacity if provided
    if (Capacity !== undefined) {
      const capacityNum = parseInt(Capacity);
      if (isNaN(capacityNum) || capacityNum <= 0) {
        errors.push('Capacity must be a positive number');
      } else {
        updateData.Capacity = capacityNum;
      }
    }
    
    // Validate and update Room_Type if provided
    if (Room_Type !== undefined) {
      if (!VALID_ROOM_TYPES.includes(Room_Type)) {
        errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
      } else {
        updateData.Room_Type = Room_Type;
      }
    }
    
    
    // Update Status if provided
    if (Status !== undefined) {
      updateData.Status = Status;
    }
    
    // Return validation errors if any
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors,
        received: req.body
      });
    }
    
    // If no valid fields to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        details: 'No valid fields provided for update'
      });
    }
    
    // Update the room
    const updatedRoom = await prisma.room.update({
      where: { Room_ID: roomId },
      data: updateData,
      select: {
        Room_ID: true,
        Name: true,
        Capacity: true,
        Room_Type: true,
        Status: true,
        Created_At: true,
        Updated_At: true
      }
    });
    
    // Create audit log
    try {
      await prisma.audit_Log.create({
        data: {
          Log_Type: 'SYSTEM',
          Action: 'ROOM_UPDATED',
          Details: JSON.stringify({
            roomId: updatedRoom.Room_ID,
            updatedFields: Object.keys(updateData).filter(k => k !== 'Updated_At'),
            previousValues: Object.fromEntries(
              Object.entries(updateData)
                .filter(([k]) => k in existingRoom)
                .map(([k]) => [k, existingRoom[k]])
            )
          })
        }
      });
    } catch (auditError) {
      console.error('Failed to create audit log:', auditError);
    }
    
    res.json({
      message: 'Room updated successfully',
      room: updatedRoom
    });
    
  } catch (error) {
    console.error('Error updating room:', error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to update room';
    
    if (error.code === 'P2025') {
      statusCode = 404;
      errorMessage = 'Room not found';
    } else if (error.code === 'P2002') {
      statusCode = 409;
      errorMessage = 'Room with this name already exists';
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.message,
      code: error.code
    });
  }
});

// Delete room
router.delete('/:id', async (req, res) => {
  const validateRoomId = (id) => {
    const roomId = parseInt(id, 10);
    if (isNaN(roomId) || roomId <= 0) {
      return { valid: false, error: 'Room ID must be a positive number' };
    }
    return { valid: true, roomId };
  };

  const { valid, roomId, error } = validateRoomId(req.params.id);
  if (!valid) {
    return res.status(400).json({ 
      error: 'Invalid room ID',
      details: error
    });
  }

  try {
    const existingRoom = await prisma.room.findUnique({
      where: { Room_ID: roomId },
      include: {
        Schedule: true,
        Booked_Room: true
      }
    });
    
    if (!existingRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check for active bookings
    const now = new Date();
    const hasActiveBookings = existingRoom.Booked_Room.some(booking => {
      return new Date(booking.End_Time) > now && booking.Status !== 'CANCELLED';
    });
    
    if (hasActiveBookings) {
      return res.status(400).json({ 
        error: 'Cannot delete room with active or future bookings' 
      });
    }
    
    // Use a transaction to ensure data consistency
    await prisma.$transaction([
      // Delete related schedules
      prisma.schedule.deleteMany({
        where: { Room_ID: roomId },
      }),
      
      // Delete related booked rooms
      prisma.booked_Room.deleteMany({
        where: { Room_ID: roomId },
      }),
      
      // Finally, delete the room
      prisma.room.delete({
        where: { Room_ID: roomId },
      })
    ]);
    
    res.json({ 
      success: true,
      message: 'Room and all related data deleted successfully' 
    });
    
  } catch (error) {
    console.error('Error deleting room:', error);
    
    let statusCode = 500;
    let errorMessage = 'Error deleting room';
    
    if (error.code === 'P2025') {
      statusCode = 404;
      errorMessage = 'Room not found';
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.message,
      code: error.code
    });
  }
});

// Schedule CRUD Operations

// Get all schedules and bookings for a room
router.get('/:roomId/schedules', async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const { day, startDate, endDate } = req.query;
    
    console.log(`Fetching schedules and bookings for room ${roomId}`);
    
    // Validate room ID and check if room exists
    const room = await prisma.room.findUnique({
      where: { Room_ID: roomId },
      select: { 
        Room_ID: true,
        Name: true
      }
    });
    
    if (!room) {
      console.error('Room not found or invalid ID:', roomId);
      return res.status(404).json({ 
        error: 'Room not found',
        details: `No room found with ID: ${roomId}`
      });
    }

    // Date range for filtering
    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = endDate ? new Date(endDate) : new Date(now.setDate(now.getDate() + 7)); // Default to 7 days

    // Get all schedules for the room
    const [schedules, bookings] = await Promise.all([
      // Regular schedules
      prisma.schedule.findMany({
        where: { 
          Room_ID: roomId,
          IsActive: true,
          OR: [
            { IsRecurring: true },
            { 
              IsRecurring: false,
              Start_Time: { gte: start },
              End_Time: { lte: end }
            }
          ]
        },
        select: {
          Schedule_ID: true,
          Title: true,
          Days: true,
          Start_Time: true,
          End_Time: true,
          IsRecurring: true,
          Schedule_Type: true,
          Created_At: true,
          Updated_At: true
        },
        orderBy: [
          { Start_Time: 'asc' },
          { End_Time: 'asc' }
        ]
      }),
      
      // Booked rooms
      prisma.booked_Room.findMany({
        where: { 
          Room_ID: roomId,
          Status: 'APPROVED',
          Start_Time: { lte: end },
          End_Time: { gte: start }
        },
        select: {
          Booked_Room_ID: true,
          Start_Time: true,
          End_Time: true,
          Status: true,
          Purpose: true,
          Created_At: true,
          Updated_At: true,
          User: {
            select: {
              First_Name: true,
              Last_Name: true,
              Email: true,
              User_Type: true
            }
          },
          Approver: {
            select: {
              First_Name: true,
              Last_Name: true,
              User_Type: true
            }
          }
        },
        orderBy: [
          { Start_Time: 'asc' },
          { End_Time: 'asc' }
        ]
      })
    ]);

    console.log(`Found ${schedules.length} schedules and ${bookings.length} bookings for room ${roomId}`);

    // Format the response
    const response = {
      room: {
        Room_ID: room.Room_ID,
        Name: room.Name
      },
      schedules: schedules.map(s => ({
        ...s,
        type: 'schedule',
        isRecurring: s.IsRecurring,
        scheduleType: s.Schedule_Type
      })),
      bookings: bookings.map(b => ({
        ...b,
        type: 'booking',
        bookedBy: b.User ? `${b.User.First_Name} ${b.User.Last_Name}` : null,
        approvedBy: b.Approver ? `${b.Approver.First_Name} ${b.Approver.Last_Name}` : null
      }))
    };

    // Filter by day if specified (0-6, where 0 is Sunday)
    if (day !== undefined) {
      const dayNum = parseInt(day);
      if (isNaN(dayNum) || dayNum < 0 || dayNum > 6) {
        return res.status(400).json({ 
          error: 'Invalid day',
          details: 'Day must be a number 0-6 (0=Sunday, 6=Saturday)'
        });
      }
      
      // Filter schedules by day
      response.schedules = response.schedules.filter(schedule => {
        if (!schedule.Days) return false;
        try {
          const days = schedule.Days.split(',').map(d => parseInt(d.trim()));
          return days.includes(dayNum);
        } catch (error) {
          console.error('Error processing schedule days:', error);
          return false;
        }
      });
      
      // Filter bookings by day
      response.bookings = response.bookings.filter(booking => {
        const bookingDay = new Date(booking.Start_Time).getDay(); // 0-6 (0=Sunday)
        return bookingDay === dayNum;
      });
      
      console.log(`Filtered to ${response.schedules.length} schedules and ${response.bookings.length} bookings for day ${dayNum}`);
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching schedules and bookings:', error);
    res.status(500).json({ 
      error: 'Error fetching schedules and bookings',
      details: error.message,
      code: error.code
    });
  }
});

// Create new schedule for multiple days
router.post('/:roomId/schedules', async (req, res) => {
  console.log('Schedule creation request:', {
    params: req.params,
    body: req.body
  });
  
  try {
    const {
      Title,
      Days = '1,2,3,4,5', // Default to weekdays (Mon-Fri)
      Start_Time,
      End_Time,
      Schedule_Type = 'STUDENT_USE', // Default to STUDENT_USE since that's the main use case
      IsRecurring = true,
      Created_By
    } = req.body;
    
    // Basic validation
    if (!Title) return res.status(400).json({ error: 'Title is required' });
    if (!Days) return res.status(400).json({ error: 'Days is required' });
    if (!Start_Time) return res.status(400).json({ error: 'Start_Time is required' });
    if (!End_Time) return res.status(400).json({ error: 'End_Time is required' });
    if (!Created_By) return res.status(400).json({ error: 'Created_By (User_ID) is required' });
    
    // Convert to Date objects for comparison
    const startTime = new Date(Start_Time);
    const endTime = new Date(End_Time);

    // Validate date format
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({ 
        error: 'Invalid date format',
        details: 'Please provide valid ISO date strings for Start_Time and End_Time'
      });
    }
    
    // Validate time range (minimum 30 minutes)
    const minDuration = 30 * 60 * 1000; // 30 minutes in milliseconds
    if (endTime <= startTime) {
      return res.status(400).json({ 
        error: 'Invalid time range',
        details: 'End time must be after start time' 
      });
    }
    
    if (endTime - startTime < minDuration) {
      return res.status(400).json({ 
        error: 'Invalid time range',
        details: 'Minimum booking duration is 30 minutes' 
      });
    }
    
    // Validate Schedule_Type
    const validScheduleTypes = ['CLASS', 'FACULTY_USE', 'STUDENT_USE', 'MAINTENANCE', 'SPECIAL_EVENT'];
    if (!validScheduleTypes.includes(Schedule_Type)) {
      return res.status(400).json({
        error: 'Invalid Schedule_Type',
        details: `Schedule_Type must be one of: ${validScheduleTypes.join(', ')}`,
        received: Schedule_Type
      });
    }
    
    // Validate Days format (comma-separated numbers 0-6)
    const daysArray = Days.split(',').map(day => parseInt(day.trim()));
    if (daysArray.some(day => isNaN(day) || day < 0 || day > 6)) {
      return res.status(400).json({
        error: 'Invalid Days format',
        details: 'Days must be comma-separated numbers 0-6 (0=Sunday, 6=Saturday)'
      });
    }
    
    // Check for conflicting schedules
    const conflict = await prisma.schedule.findFirst({
      where: {
        Room_ID: parseInt(req.params.roomId),
        IsActive: true,
        OR: [
          {
            // New schedule starts during an existing schedule
            Start_Time: { lte: startTime },
            End_Time: { gt: startTime }
          },
          {
            // New schedule ends during an existing schedule
            Start_Time: { lt: endTime },
            End_Time: { gte: endTime }
          },
          {
            // New schedule completely contains an existing schedule
            Start_Time: { gte: startTime },
            End_Time: { lte: endTime }
          }
        ]
      }
    });
    
    if (conflict) {
      return res.status(409).json({
        error: 'Schedule conflict',
        details: 'The selected time slot conflicts with an existing schedule',
        conflictingSchedule: conflict
      });
    }
    
    // Sort and deduplicate days
    const uniqueDays = [...new Set(daysArray)].sort((a, b) => a - b);
    const daysString = uniqueDays.join(',');
    
    // Create schedule with required fields
    const scheduleData = {
      Room_ID: parseInt(req.params.roomId),
      Title: Title,
      Schedule_Type,
      Days: uniqueDays.join(','),
      Start_Time: startTime,
      End_Time: endTime,
      IsRecurring,
      Created_By: parseInt(Created_By),
      Created_At: new Date(),
      Updated_At: new Date(),
      IsActive: true,  // Default to active
    };
    
    console.log('Creating schedule with data:', scheduleData);
    
    const schedule = await prisma.schedule.create({
      data: scheduleData,
    });
    
    console.log('Schedule created successfully:', schedule);
    res.status(201).json(schedule);
  } catch (error) {
    console.error('Error creating schedule:', {
      error: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Error creating schedule',
      details: error.message,
      code: error.code,
      meta: error.meta
    });
  }
});

// Update schedule
router.put('/schedules/:scheduleId', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.scheduleId);
    const {
      Name,
      Days,
      Start_Time,
      End_Time,
      IsActive = true,
    } = req.body;
    
    // Check if schedule exists
    const existingSchedule = await prisma.schedule.findUnique({
      where: { Schedule_ID: scheduleId }
    });
    
    if (!existingSchedule) {
      return res.status(404).json({
        error: 'Schedule not found',
        details: `No schedule found with ID: ${scheduleId}`
      });
    }
    
    // Prepare update data with only provided fields
    const updateData = {
      Updated_At: new Date(),
    };
    
    // Only include fields that are provided in the request
    if (Name !== undefined) updateData.Name = Name;
    if (Days !== undefined) updateData.Days = Days;
    if (Start_Time) updateData.Start_Time = new Date(Start_Time);
    if (End_Time) updateData.End_Time = new Date(End_Time);
    if (IsActive !== undefined) updateData.IsActive = IsActive;
    
    // If Days is being updated, validate it
    if (Days !== undefined) {
      const daysArray = Days.split(',').map(day => parseInt(day.trim()));
      if (daysArray.some(day => isNaN(day) || day < 0 || day > 6)) {
        return res.status(400).json({
          error: 'Invalid Days format',
          details: 'Days must be comma-separated numbers 0-6 (0=Sunday, 6=Saturday)'
        });
      }
      // Sort and deduplicate days
      const uniqueDays = [...new Set(daysArray)].sort((a, b) => a - b);
      updateData.Days = uniqueDays.join(',');
    }
    
    const updatedSchedule = await prisma.schedule.update({
      where: { Schedule_ID: scheduleId },
      data: updateData,
    });
    
    res.json(updatedSchedule);
  } catch (error) {
    console.error('Error updating schedule:', {
      error: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Error updating schedule',
      details: error.message,
      code: error.code
    });
  }
});

// Delete schedule
router.delete('/schedules/:scheduleId', async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId);
  
  if (isNaN(scheduleId)) {
    return res.status(400).json({ 
      error: 'Invalid schedule ID',
      details: 'Schedule ID must be a number'
    });
  }
  
  try {
    console.log(`Attempting to delete schedule with ID: ${scheduleId}`);
    
    // First, check if schedule exists
    const schedule = await prisma.schedule.findUnique({
      where: { Schedule_ID: scheduleId }
    });
    
    if (!schedule) {
      return res.status(404).json({
        error: 'Schedule not found',
        details: `No schedule found with ID: ${scheduleId}`
      });
    }
    
    // Delete the schedule (no need to delete related bookings as there's no direct relationship)
    await prisma.schedule.delete({
      where: { Schedule_ID: scheduleId }
    });
    
    console.log(`Successfully deleted schedule with ID: ${scheduleId}`);
    res.json({ 
      message: 'Schedule deleted successfully',
      deletedScheduleId: scheduleId
    });
  } catch (error) {
    console.error('Error in delete schedule:', {
      error: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack  
    });
    
    // Provide more specific error messages
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        error: 'Schedule not found',
        details: error.meta?.cause || 'The specified schedule does not exist'
      });
    }
    
    res.status(500).json({ 
      error: 'Error deleting schedule',
      details: error.message,
      code: error.code,
      meta: error.meta
    });
  }
});

// Get room availability
router.get('/:id/availability', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    
    // Get all schedules for the room
    const schedules = await prisma.schedule.findMany({
      where: { 
        Room_ID: parseInt(req.params.id),
        IsActive: true,
        OR: [
          { RecurrenceEndDate: null },
          { RecurrenceEndDate: { gte: targetDate } }
        ]
      },
    });
    
    // Get all bookings for the room on the target date
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const bookings = await prisma.booked_Room.findMany({
      where: {
        Room_ID: parseInt(req.params.id),
        Start_Time: { lte: endOfDay },
        End_Time: { gte: startOfDay },
        Status: 'APPROVED',
      },
    });
    
    // Process schedules and bookings to determine availability
    const availability = {
      date: targetDate.toISOString().split('T')[0],
      schedules: [],
      bookings: bookings.map(booking => ({
        id: booking.Booked_Room_ID,
        title: booking.Title,
        start: booking.Start_Time,
        end: booking.End_Time,
        status: booking.Status,
      })),
    };
    
    res.json(availability);
  } catch (error) {
    console.error('Error checking room availability:', error);
    res.status(500).json({ error: 'Error checking room availability' });
  }
});

module.exports = router;
