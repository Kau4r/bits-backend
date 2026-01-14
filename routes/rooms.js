const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get all rooms
router.get('/', async (req, res) => {
  try {
    // Get all rooms (no booked rooms included)
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
router.post('/', async (req, res) => {
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
    const existingRoom = await prisma.room.findFirst({
      where: { Name: { equals: Name.trim(), mode: 'insensitive' } }
    });

    if (existingRoom) {
      return res.status(409).json({ error: 'Room already exists', details: `A room named '${Name}' already exists`, existingRoomId: existingRoom.Room_ID });
    }

    const newRoom = await prisma.room.create({
      data: { Name: Name.trim(), Capacity: parseInt(Capacity), Room_Type: Room_Type || 'LECTURE', Status: 'AVAILABLE' },
      select: { Room_ID: true, Name: true, Capacity: true, Room_Type: true, Status: true, Created_At: true, Updated_At: true }
    });

    res.status(201).json(newRoom);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room', details: error.message });
  }
});

// Update room
router.put('/:id', async (req, res) => {
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
    const updatedRoom = await prisma.room.update({ where: { Room_ID: roomId }, data: updateData });
    res.json({ message: 'Room updated successfully', room: updatedRoom });
  } catch (error) {
    console.error('Error updating room:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Room not found', details: error.message });
    res.status(500).json({ error: 'Failed to update room', details: error.message });
  }
});

// Delete room
router.delete('/:id', async (req, res) => {
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID', details: 'Room ID must be a positive number' });

  try {
    const existingRoom = await prisma.room.findUnique({ where: { Room_ID: roomId }, include: { Booked_Rooms: true, Schedule: true } });
    if (!existingRoom) return res.status(404).json({ error: 'Room not found' });

    const now = new Date();
    const hasActiveBookings = existingRoom.Booked_Rooms.some(b => new Date(b.End_Time) > now && b.Status !== 'CANCELLED');
    if (hasActiveBookings) return res.status(400).json({ error: 'Cannot delete room with active or future bookings' });

    await prisma.$transaction([
      prisma.schedule.deleteMany({ where: { Room_ID: roomId } }),
      prisma.booked_Room.deleteMany({ where: { Room_ID: roomId } }),
      prisma.room.delete({ where: { Room_ID: roomId } })
    ]);

    res.json({ success: true, message: 'Room and related data deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Error deleting room', details: error.message });
  }
});

module.exports = router;
