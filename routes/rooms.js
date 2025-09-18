const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// GET all rooms
router.get('/', async (req, res) => {
  try {
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
    res.status(500).json({ error: 'Failed to fetch rooms', details: error.message });
  }
});

// GET room by ID
router.get('/:id', async (req, res) => {
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID' });

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

    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Failed to fetch room', details: error.message });
  }
});

// POST create room
router.post('/', async (req, res) => {
  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const { Name, Capacity, Room_Type, Created_By } = req.body;

  // Validation
  const errors = [];
  if (!Name?.trim()) errors.push('Name is required');
  if (!Capacity || isNaN(Capacity) || Capacity <= 0) errors.push('Valid capacity is required');
  if (Room_Type && !VALID_ROOM_TYPES.includes(Room_Type)) {
    errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
  }

  const userId = parseInt(Created_By);
  if (isNaN(userId)) errors.push('Created_By must be a valid User_ID');

  if (errors.length) return res.status(400).json({ error: 'Validation Error', details: errors });

  try {
    const existingRoom = await prisma.room.findFirst({
      where: { Name: { equals: Name.trim(), mode: 'insensitive' } }
    });
    if (existingRoom) return res.status(409).json({ error: 'Room already exists', existingRoomId: existingRoom.Room_ID });

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

    // Audit log
    try {
      await prisma.audit_Log.create({
        data: {
          Action: "ROOM_CREATED", // <-- match schema
          details: JSON.stringify({ roomId: newRoom.Room_ID, roomName: newRoom.Name }),
          timestamp: new Date(),
          User: { connect: { User_ID: userId } }
        }
      })
    } catch (auditError) {
      console.error('Audit log error:', auditError);
    }

    res.status(201).json(newRoom);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room', details: error.message });
  }
});

// PUT update room
router.put('/:id', async (req, res) => {
  const VALID_ROOM_TYPES = ['CONSULTATION', 'LECTURE', 'LAB'];
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID' });

  try {
    const existingRoom = await prisma.room.findUnique({ where: { Room_ID: roomId } });
    if (!existingRoom) return res.status(404).json({ error: 'Room not found' });

    const { Name, Capacity, Room_Type, Status, Updated_By } = req.body;
    const updateData = {};
    const errors = [];

    if (Name !== undefined) {
      if (!Name.trim()) errors.push('Name must be non-empty'); else updateData.Name = Name.trim();
    }
    if (Capacity !== undefined) {
      const cap = parseInt(Capacity);
      if (isNaN(cap) || cap <= 0) errors.push('Capacity must be positive'); else updateData.Capacity = cap;
    }
    if (Room_Type !== undefined) {
      if (!VALID_ROOM_TYPES.includes(Room_Type)) errors.push(`Room_Type must be one of: ${VALID_ROOM_TYPES.join(', ')}`);
      else updateData.Room_Type = Room_Type;
    }
    if (Status !== undefined) updateData.Status = Status;

    const userId = parseInt(Updated_By);
    if (isNaN(userId)) errors.push('Updated_By must be a valid User_ID');

    if (errors.length) return res.status(400).json({ error: 'Validation Error', details: errors });
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No valid fields provided for update' });

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

    // Audit log
    try {
      await prisma.audit_Log.create({
        data: {
          Action: 'ROOM_UPDATED',
          details: JSON.stringify({
            roomId: updatedRoom.Room_ID,
            updatedFields: Object.keys(updateData),
            previousValues: Object.fromEntries(
              Object.entries(updateData).map(([k]) => [k, existingRoom[k]])
            )
          }),
          timestamp: new Date(),
          User: { connect: { User_ID: userId } }
        }
      });
    } catch (auditError) {
      console.error('Audit log error:', auditError);
    }

    res.json({ message: 'Room updated', room: updatedRoom });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ error: 'Failed to update room', details: error.message });
  }
});

// DELETE room
router.delete('/:id', async (req, res) => {
  const roomId = parseInt(req.params.id);
  if (isNaN(roomId) || roomId <= 0) return res.status(400).json({ error: 'Invalid room ID' });

  try {
    const existingRoom = await prisma.room.findUnique({
      where: { Room_ID: roomId },
      include: { Booked_Room: true, Schedule: true }
    });
    if (!existingRoom) return res.status(404).json({ error: 'Room not found' });

    const now = new Date();
    const hasActive = existingRoom.Booked_Room.some(b => new Date(b.End_Time) > now && b.Status !== 'CANCELLED');
    if (hasActive) return res.status(400).json({ error: 'Cannot delete room with active bookings' });

    await prisma.$transaction([
      prisma.schedule.deleteMany({ where: { Room_ID: roomId } }),
      prisma.booked_Room.deleteMany({ where: { Room_ID: roomId } }),
      prisma.room.delete({ where: { Room_ID: roomId } })
    ]);

    res.json({ success: true, message: 'Room and related data deleted' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Failed to delete room', details: error.message });
  }
});

module.exports = router;
