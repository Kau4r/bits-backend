const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get all rooms
router.get('/', async (req, res) => {
  console.log('\n=== GET /rooms request received ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    // Verify database connection
    console.log('Testing database connection...');
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful');
    
    console.log('\n🔍 Querying rooms from database...');
    // First, get all rooms with basic info
    const rooms = await prisma.room.findMany({
      orderBy: {
        Room_ID: 'asc'
      }
    });
    
    // Then get schedules and bookings separately to avoid relation issues
    const roomsWithDetails = await Promise.all(rooms.map(async (room) => {
      // Get schedules for the room
      let schedules = [];
      try {
        schedules = await prisma.schedule.findMany({
          where: { Room_ID: room.Room_ID },
          select: {
            Schedule_ID: true,
            Days: true,
            Start_Time: true,
            End_Time: true,
            Created_At: true,
            Updated_At: true
          }
        });
      } catch (error) {
        console.error('Error fetching schedules:', error);
      }
      
      // Get bookings for the room
      let bookings = [];
      try {
        // First try with basic fields that should always exist
        const bookingFields = {
          Booked_Room_ID: true,
          Room_ID: true,
          User_ID: true,
          Start_Time: true,
          End_Time: true,
          Status: true,
          Created_At: true,
          Updated_At: true
        };
        
        // Try to get bookings with basic fields first
        bookings = await prisma.Booked_Room.findMany({
          where: { Room_ID: room.Room_ID },
          select: bookingFields
        });
      } catch (error) {
        console.error('Error fetching bookings:', error);
        // If there's an error, try with minimal fields
        try {
          bookings = await prisma.Booked_Room.findMany({
            where: { Room_ID: room.Room_ID },
            select: {
              Booked_Room_ID: true,
              Room_ID: true,
              User_ID: true,
              Start_Time: true,
              End_Time: true,
              Status: true
            }
          });
        } catch (innerError) {
          console.error('Error with minimal booking fields:', innerError);
        }
      }
      
      return {
        ...room,
        Schedule: schedules,
        Booked_Room: bookings
      };
    }));
    
    console.log(`\n📊 Found ${rooms.length} rooms in database`);
    if (rooms.length > 0) {
      console.log('\nSample room data:');
      console.log(JSON.stringify(rooms[0], null, 2));
    }
    
    // Log the response being sent
    console.log('\n📤 Sending response with status 200');
    console.log('Response body:', JSON.stringify(rooms, null, 2));
    
    // Set explicit content type
    res.setHeader('Content-Type', 'application/json');
    res.json(rooms);
  } catch (error) {
    console.error('Error in GET /rooms:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Error fetching rooms',
      details: error.message,
      code: error.code,
      meta: error.meta
    });
  }
});

// Get room by ID
router.get('/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    
    // Validate room ID
    if (isNaN(roomId)) {
      return res.status(400).json({ 
        error: 'Invalid room ID',
        details: 'Room ID must be a number'
      });
    }
    
    // First get the basic room info
    const room = await prisma.room.findUnique({
      where: { Room_ID: roomId }
    });

    if (!room) {
      return res.status(404).json({ 
        error: 'Room not found',
        details: `No room found with ID: ${roomId}`
      });
    }

    // Get schedules for the room
    let schedules = [];
    try {
      schedules = await prisma.schedule.findMany({
        where: { Room_ID: roomId },
        select: {
          Schedule_ID: true,
          Days: true,
          Start_Time: true,
          End_Time: true,
          Created_At: true,
          Updated_At: true
        }
      });
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }

    // Get active bookings for the room
    let bookings = [];
    try {
      bookings = await prisma.Booked_Room.findMany({
        where: {
          Room_ID: roomId,
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
        orderBy: {
          Start_Time: 'asc'
        }
      });
    } catch (error) {
      console.error('Error fetching bookings:', error);
    }

    // Combine the data
    const roomWithDetails = {
      ...room,
      Schedule: schedules,
      Booked_Room: bookings
    };
    
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
      error: 'Error fetching room',
      details: error.message,
      code: error.code
    });
  }
});

// Create new room
router.post('/', async (req, res) => {
  console.log('Request body:', req.body);
  
  try {
    const { Name, Capacity } = req.body;
    
    // Validate required fields
    if (!Name || typeof Name !== 'string' || Name.trim() === '') {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: 'Name is required and must be a non-empty string',
        received: req.body
      });
    }
    
    // Validate Capacity if provided
    if (Capacity !== undefined) {
      const capacityNum = parseInt(Capacity);
      if (isNaN(capacityNum) || capacityNum < 0) {
        return res.status(400).json({
          error: 'Validation Error',
          details: 'Capacity must be a non-negative number',
          received: Capacity
        });
      }
    }
    
    const roomData = {
      Name: Name.trim(),
      Capacity: Capacity !== undefined ? parseInt(Capacity) : 0,
      Created_At: new Date(),
      Updated_At: new Date()
    };
    
    console.log('Creating room with data:', roomData);
    
    const room = await prisma.room.create({
      data: roomData,
    });
    
    console.log('Room created successfully:', room);
    res.status(201).json(room);
  } catch (error) {
    console.error('Error creating room:', error);
    const statusCode = error.code === 'P2002' ? 409 : 500; // Handle unique constraint violation
    res.status(statusCode).json({ 
      error: 'Error creating room',
      details: error.message,
      code: error.code,
      meta: error.meta
    });
  }
});

// Update room
router.put('/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const { Name, Capacity } = req.body;
    
    // Validate room ID
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }
    
    // Check if room exists
    const existingRoom = await prisma.room.findUnique({
      where: { Room_ID: roomId },
    });
    
    if (!existingRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Validate input
    const updateData = { Updated_At: new Date() };
    
    if (Name !== undefined) {
      if (typeof Name !== 'string' || Name.trim() === '') {
        return res.status(400).json({ error: 'Name must be a non-empty string' });
      }
      updateData.Name = Name.trim();
    }
    
    if (Capacity !== undefined) {
      const capacityNum = parseInt(Capacity);
      if (isNaN(capacityNum) || capacityNum < 0) {
        return res.status(400).json({ error: 'Capacity must be a non-negative number' });
      }
      updateData.Capacity = capacityNum;
    }
    
    // If no valid fields to update
    if (Object.keys(updateData).length <= 1) { // Only has Updated_At
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    const updatedRoom = await prisma.room.update({
      where: { Room_ID: roomId },
      data: updateData,
    });
    
    res.json(updatedRoom);
  } catch (error) {
    console.error('Error updating room:', error);
    
    let statusCode = 500;
    let errorMessage = 'Error updating room';
    
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
  try {
    const roomId = parseInt(req.params.id);
    
    // Validate room ID
    if (isNaN(roomId)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }
    
    // Check if room exists
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

// Get all schedules for a room
router.get('/:roomId/schedules', async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const { day } = req.query;
    
    console.log(`Fetching schedules for room ${roomId}`);
    
    // Validate room ID
    if (isNaN(roomId)) {
      console.error('Invalid room ID:', req.params.roomId);
      return res.status(400).json({ 
        error: 'Invalid room ID',
        details: 'Room ID must be a number'
      });
    }
    
    // Check if room exists
    const room = await prisma.room.findUnique({
      where: { Room_ID: roomId },
      select: { 
        Room_ID: true,
        Name: true
      }
    });
    
    if (!room) {
      console.error('Room not found:', roomId);
      return res.status(404).json({ 
        error: 'Room not found',
        details: `No room found with ID: ${roomId}`
      });
    }
    
    // Get all schedules for the room with only the fields that exist in the database
    let schedules = [];
    try {
      // First, get the minimal schedule data
      schedules = await prisma.schedule.findMany({
        where: { Room_ID: roomId },
        select: {
          Schedule_ID: true,
          Days: true,
          Start_Time: true,
          End_Time: true,
          // Only include fields that definitely exist in the database
          Created_At: true,
          Updated_At: true
        },
        orderBy: [
          { Start_Time: 'asc' },
          { End_Time: 'asc' }
        ]
      });
      
      console.log(`Found ${schedules.length} schedules for room ${roomId}`);
      
    } catch (error) {
      console.error('Error fetching schedules:', error);
      return res.status(500).json({ 
        error: 'Error fetching schedules',
        details: error.message,
        code: error.code
      });
    }
    
    // Filter by day if specified (0-6, where 0 is Sunday)
    let filteredSchedules = [...schedules];
    if (day !== undefined) {
      const dayNum = parseInt(day);
      if (isNaN(dayNum) || dayNum < 0 || dayNum > 6) {
        return res.status(400).json({ 
          error: 'Invalid day',
          details: 'Day must be a number 0-6 (0=Sunday, 6=Saturday)'
        });
      }
      
      // Filter schedules that include the specified day
      filteredSchedules = schedules.filter(schedule => {
        if (!schedule.Days) return false;
        try {
          const days = schedule.Days.split(',').map(d => parseInt(d.trim()));
          return days.includes(dayNum);
        } catch (error) {
          console.error('Error processing schedule days:', error);
          return false;
        }
      });
      
      console.log(`Filtered to ${filteredSchedules.length} schedules for day ${dayNum}`);
    }
    
    res.json(filteredSchedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ error: 'Error fetching schedules' });
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
      Name,
      Description,
      Days = '1,2,3,4,5', // Default to weekdays (Mon-Fri)
      Start_Time,
      End_Time,
      IsRecurring = true,
      EndDate = null
    } = req.body;
    
    // Basic validation
    if (!Name) return res.status(400).json({ error: 'Name is required' });
    if (!Days) return res.status(400).json({ error: 'Days is required' });
    if (!Start_Time) return res.status(400).json({ error: 'Start_Time is required' });
    if (!End_Time) return res.status(400).json({ error: 'End_Time is required' });
    
    // Validate Days format (comma-separated numbers 0-6)
    const daysArray = Days.split(',').map(day => parseInt(day.trim()));
    if (daysArray.some(day => isNaN(day) || day < 0 || day > 6)) {
      return res.status(400).json({
        error: 'Invalid Days format',
        details: 'Days must be comma-separated numbers 0-6 (0=Sunday, 6=Saturday)'
      });
    }
    
    // Parse dates to ensure they're valid
    const startTime = new Date(Start_Time);
    const endTime = new Date(End_Time);
    const endDateObj = EndDate ? new Date(EndDate) : null;
    
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime()) || (endDateObj && isNaN(endDateObj.getTime()))) {
      return res.status(400).json({ 
        error: 'Invalid date format',
        details: 'Please provide valid ISO date strings for Start_Time, End_Time, and EndDate'
      });
    }
    
    // Sort and deduplicate days
    const uniqueDays = [...new Set(daysArray)].sort((a, b) => a - b);
    const daysString = uniqueDays.join(',');
    
    // Create schedule with only fields that exist in the database
    const scheduleData = {
      Room_ID: parseInt(req.params.roomId),
      Days: daysString,
      Start_Time: startTime,
      End_Time: endTime
      // Note: Not including Name and Description as they don't exist in the database
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
      Description,
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
    if (Description !== undefined) updateData.Description = Description;
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
