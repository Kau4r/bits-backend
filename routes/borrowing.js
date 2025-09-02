const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Borrow a computer
router.post('/', async (req, res) => {
    try {
        const { User_ID, Computer_ID, Expected_Return_Time } = req.body;

        if (!User_ID || !Computer_ID || !Expected_Return_Time) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get computer with room and schedule info
        const computer = await prisma.computer.findUnique({
            where: { Computer_ID: parseInt(Computer_ID) },
            include: {
                Room: {
                    include: {
                        Schedules: {
                            where: {
                                IsActive: true,
                                Start_Time: { lte: new Date() },
                                End_Time: { gte: new Date() }
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

        // Check if there's an active schedule that allows borrowing
        const currentSchedule = computer.Room.Schedules[0];
        if (!currentSchedule || currentSchedule.Schedule_Type !== 'STUDENT_USE') {
            return res.status(403).json({
                error: 'Borrowing not allowed',
                details: 'Computer can only be borrowed during student use hours'
            });
        }

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
                Return_Date: new Date(Expected_Return_Time),
                Status: 'BORROWED'
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
        const { status = 'RETURNED', notes } = req.body;

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
                Status: status,
                Notes: notes,
                Actual_Return_Date: new Date(),
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
