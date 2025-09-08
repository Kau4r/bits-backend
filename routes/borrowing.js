const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Borrow a computer
router.post('/', async (req, res) => {
    try {
        const { User_ID, Computer_ID, Return_Date, Status = 'BORROWED' } = req.body;

        if (!User_ID || !Computer_ID || !Return_Date) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                required: ['User_ID', 'Computer_ID', 'Return_Date'],
                received: { User_ID, Computer_ID, Return_Date }
            });
        }

        // For testing purposes - set to true to bypass schedule checks
        const TEST_MODE = true;
        
        // Get current time and day
        const currentTime = new Date();
        let currentDay = currentTime.getDay() || 7; // Convert 0 (Sunday) to 7
        
        // Get computer with room and schedule info
        const computer = await prisma.computer.findUnique({
            where: { Computer_ID: parseInt(Computer_ID) },
            include: {
                Room: {
                    include: {
                        Schedule: {
                            where: {
                                IsActive: true,
                                Schedule_Type: TEST_MODE ? undefined : 'STUDENT_USE',
                                Days: TEST_MODE ? undefined : { contains: currentDay.toString() },
                                OR: [
                                    {
                                        // For recurring schedules
                                        IsRecurring: true,
                                        Start_Time: { lte: currentTime },
                                        End_Time: { gte: currentTime }
                                    },
                                    {
                                        // For one-time schedules
                                        IsRecurring: false,
                                        Start_Time: { lte: currentTime },
                                        End_Time: { gte: currentTime },
                                        Start_Time: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                                        End_Time: { lte: new Date(new Date().setHours(23, 59, 59, 999)) }
                                    }
                                ]
                            },
                            orderBy: { Start_Time: 'desc' },
                            take: 1
                        }
                    }
                }
            }
        });

        if (!computer) {
            return res.status(404).json({ error: 'Computer not found' });
        }

        // Check if computer is in a room that's open
        if (!computer.Room || computer.Room.Status !== 'AVAILABLE') {
            return res.status(403).json({ 
                error: 'Computer is not available for borrowing',
                details: 'The room is either closed or not available for use'
            });
        }

        // Debug: Log the current time and day for verification
        console.log('Current time:', new Date().toISOString());
        console.log('Current day:', currentDay);
        
        // Check if there's an active schedule that allows borrowing
        if (!TEST_MODE && (!computer.Room.Schedule || computer.Room.Schedule.length === 0)) {
            console.log('No matching schedule found. Available schedules:', 
                await prisma.schedule.findMany({
                    where: { 
                        Room_ID: computer.Room.Room_ID,
                        IsActive: true,
                        Schedule_Type: 'STUDENT_USE'
                    }
                })
            );
            
            return res.status(403).json({
                error: 'Borrowing not allowed',
                details: 'No active student use schedule found for this computer.',
                currentTime: new Date().toISOString(),
                currentDay: currentDay,
                roomId: computer.Room.Room_ID,
                testMode: TEST_MODE
            });
        }
        
        const currentSchedule = computer.Room.Schedule[0];

        // Check if computer is already borrowed
        const existingBorrowing = await prisma.Borrowing_Comp.findFirst({
            where: {
                Computer_ID: parseInt(Computer_ID),
                Status: 'BORROWED',
                Return_Date: { gte: new Date() }
            }
        });

        if (existingBorrowing) {
            return res.status(409).json({ 
                error: 'Computer is already borrowed',
                currentBorrowing: existingBorrowing
            });
        }

        // Create borrowing record
        const borrowing = await prisma.Borrowing_Comp.create({
            data: {
                User_ID: parseInt(User_ID),
                Computer_ID: parseInt(Computer_ID),
                Borrow_Date: new Date(),
                Return_Date: new Date(Return_Date),
                Status: Status,
                Updated_At: new Date()
            },
            include: {
                Computer: true,
                User: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            }
        });

        // Update computer status
        await prisma.Computer.update({
            where: { Computer_ID: parseInt(Computer_ID) },
            data: { Status: 'IN_USE' }
        });

        res.status(201).json(borrowing);

    } catch (error) {
        console.error('Borrowing error:', error);
        res.status(500).json({ 
            error: 'Failed to process borrowing', 
            details: error.message 
        });
    }
});

// Return a borrowed computer
router.patch('/:id/return', async (req, res) => {
    try {
        const { id } = req.params;
        const { Status = 'RETURNED' } = req.body;

        const borrowing = await prisma.Borrowing_Comp.findUnique({
            where: { Borrowing_Comp_ID: parseInt(id) }
        });

        if (!borrowing) {
            return res.status(404).json({ error: 'Borrowing record not found' });
        }

        // Update borrowing record
        const updatedBorrowing = await prisma.Borrowing_Comp.update({
            where: { Borrowing_Comp_ID: parseInt(id) },
            data: { 
                Status: Status,
                Updated_At: new Date()
            }
        });

        // Update computer status
        await prisma.Computer.update({
            where: { Computer_ID: borrowing.Computer_ID },
            data: { Status: 'AVAILABLE' }
        });

        res.json(updatedBorrowing);

    } catch (error) {
        console.error('Return error:', error);
        res.status(500).json({ 
            error: 'Failed to process return', 
            details: error.message 
        });
    }
});

// Get all active borrowings
router.get('/active', async (req, res) => {
    try {
        const activeBorrowings = await prisma.Borrowing_Comp.findMany({
            where: {
                Status: 'BORROWED',
                Return_Date: { gte: new Date() }
            },
            include: {
                Computer: true,
                User: {
                    select: {
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                }
            },
            orderBy: {
                Return_Date: 'asc'
            }
        });

        res.json(activeBorrowings);
    } catch (error) {
        console.error('Error fetching active borrowings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch active borrowings', 
            details: error.message 
        });
    }
});

module.exports = router;
