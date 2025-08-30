const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

// Create a new room booking
router.post('/', async (req, res) => {
    try {
        const { User_ID, Room_ID, Start_Time, End_Time, Purpose } = req.body;

        if (!User_ID || !Room_ID || !Start_Time || !End_Time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check if room is available
        const conflictingBooking = await prisma.Booked_Room.findFirst({
            where: {
                Room_ID: parseInt(Room_ID),
                Status: 'APPROVED',
                OR: [
                    {
                        Start_Time: { lte: new Date(End_Time) },
                        End_Time: { gte: new Date(Start_Time) }
                    }
                ]
            }
        });

        if (conflictingBooking) {
            return res.status(409).json({ 
                error: 'Room is already booked for the selected time',
                conflictingBooking
            });
        }

        // Create booking
        const booking = await prisma.Booked_Room.create({
            data: {
                Room_ID: parseInt(Room_ID),
                User_ID: parseInt(User_ID),
                Start_Time: new Date(Start_Time),
                End_Time: new Date(End_Time),
                Purpose: Purpose || '',
                Status: 'PENDING'
            },
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            }
        });

        res.status(201).json(booking);

    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ 
            error: 'Failed to create booking', 
            details: error.message 
        });
    }
});

// Get all room bookings
router.get('/', async (req, res) => {
    try {
        const { status, roomId, userId } = req.query;
        
        const where = {};
        if (status) where.Status = status;
        if (roomId) where.Room_ID = parseInt(roomId);
        if (userId) where.User_ID = parseInt(userId);

        const bookings = await prisma.Booked_Room.findMany({
            where,
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            },
            orderBy: {
                Start_Time: 'desc'
            }
        });

        res.json(bookings);
    } catch (error) {
        console.error('Error fetching room bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch room bookings', 
            details: error.message 
        });
    }
});

// Update room booking status
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, approverId, notes } = req.body;

        if (!status || !['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const booking = await prisma.Booked_Room.update({
            where: { Booked_Room_ID: parseInt(id) },
            data: { 
                Status: status,
                Updated_At: new Date(),
                ...(approverId && { Approved_By: parseInt(approverId) }),
                ...(notes && { Notes: notes })
            },
            include: {
                Room: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            }
        });

        res.json(booking);
    } catch (error) {
        console.error('Error updating room booking status:', error);
        res.status(500).json({ 
            error: 'Failed to update room booking status', 
            details: error.message 
        });
    }
});

// Get available rooms for a time period
router.get('/available', async (req, res) => {
    try {
        const { startTime, endTime, capacity } = req.query;
        
        if (!startTime || !endTime) {
            return res.status(400).json({ error: 'Start time and end time are required' });
        }

        // Find all rooms that have no conflicting bookings
        const availableRooms = await prisma.$queryRaw`
            SELECT r.* 
            FROM "Room" r
            WHERE r."Capacity" >= COALESCE(${parseInt(capacity) || 1}, 1)
            AND r."Room_ID" NOT IN (
                SELECT br."Room_ID"
                FROM "Booked_Room" br
                WHERE br."Status" = 'APPROVED'
                AND (
                    (br."Start_Time" < ${new Date(endTime)} AND br."End_Time" > ${new Date(startTime)})
                )
            )
            ORDER BY r."Capacity" ASC
        `;

        res.json(availableRooms);
    } catch (error) {
        console.error('Error finding available rooms:', error);
        res.status(500).json({ 
            error: 'Failed to find available rooms', 
            details: error.message 
        });
    }
});

module.exports = router;
