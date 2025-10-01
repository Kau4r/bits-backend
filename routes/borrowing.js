const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

// Middleware to extract user from JWT
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token provided' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Invalid token' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Borrow endpoint
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { Item_ID, Computer_ID, Return_Date } = req.body;

        if (!Return_Date) return res.status(400).json({ error: 'Return_Date is required' });

        // Fetch user
        const user = await prisma.User.findUnique({ where: { User_ID: req.userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let borrowing;
        const now = new Date();

        if (user.User_Role === 'STUDENT') {
            if (!Computer_ID) return res.status(400).json({ error: 'Computer_ID is required for students' });

            // Check if computer exists and is available
            const computer = await prisma.Computer.findUnique({ where: { Computer_ID: parseInt(Computer_ID) } });
            if (!computer || computer.Status !== 'AVAILABLE') {
                return res.status(403).json({ error: 'Computer not available' });
            }

            // Check if computer is already borrowed
            const existingBorrow = await prisma.Borrowing_Comp.findFirst({
                where: {
                    Computer_ID: parseInt(Computer_ID),
                    Status: 'BORROWED',
                    Return_Date: { gte: now }
                }
            });
            if (existingBorrow) return res.status(409).json({ error: 'Computer already borrowed' });

            // Create borrowing record
            borrowing = await prisma.Borrowing_Comp.create({
                data: {
                    User_ID: user.User_ID,
                    Computer_ID: parseInt(Computer_ID),
                    Borrow_Date: now,
                    Return_Date: new Date(Return_Date),
                    Status: 'BORROWED'
                },
                include: { Computer: true, User: true }
            });

            // Update computer status
            await prisma.Computer.update({
                where: { Computer_ID: parseInt(Computer_ID) },
                data: { Status: 'IN_USE' }
            });

        } else if (user.User_Role === 'FACULTY') {
            if (!Item_ID) return res.status(400).json({ error: 'Item_ID is required for faculty' });

            // Check if item exists and is available
            const item = await prisma.Item.findUnique({ where: { Item_ID: parseInt(Item_ID) } });
            if (!item || item.Status !== 'AVAILABLE') {
                return res.status(403).json({ error: 'Item not available' });
            }

            // Check if item is already borrowed
            const existingBorrow = await prisma.Borrow_Item.findFirst({
                where: {
                    Item_ID: parseInt(Item_ID),
                    Status: 'BORROWED',
                    Return_Date: { gte: now }
                }
            });
            if (existingBorrow) return res.status(409).json({ error: 'Item already borrowed' });

            // For Faculty borrowing
            borrowing = await prisma.Borrowed_Items.create({
                data: {
                    User_ID: user.User_ID,
                    Item_ID: parseInt(Item_ID),
                    Borrow_Date: now,
                    Return_Date: new Date(Return_Date),
                    Status: 'BORROWED'
                },
                include: { Items: true, User: true }  // Use Items instead of Item
            });

            // Update item status
            await prisma.Item.update({
                where: { Item_ID: parseInt(Item_ID) },
                data: { Status: 'BORROWED' }
            });

        } else {
            return res.status(403).json({ error: 'You are not allowed to borrow' });
        }

        res.status(201).json(borrowing);

    } catch (error) {
        console.error('Borrowing error:', error);
        res.status(500).json({ error: 'Failed to process borrowing', details: error.message });
    }
});

// Return endpoint (works for both)
router.patch('/:id/return', authMiddleware, async (req, res) => {
    try {
        const { Status = 'RETURNED', Type } = req.body; // Type: 'COMPUTER' or 'ITEM'
        const { id } = req.params;

        if (!Type) return res.status(400).json({ error: 'Type (COMPUTER/ITEM) is required' });

        let borrowing, updateData;

        if (Type === 'COMPUTER') {
            borrowing = await prisma.Borrowing_Comp.findUnique({ where: { Borrowing_Comp_ID: parseInt(id) } });
            if (!borrowing) return res.status(404).json({ error: 'Borrowing record not found' });

            updateData = await prisma.Borrowed_Items.update({
                where: { Borrow_Item_ID: parseInt(id) },
                data: { Status, Updated_At: new Date() }
            });

            await prisma.Items.update({
                where: { Item_ID: borrowing.Item_ID },
                data: { Status: 'AVAILABLE' }
            });


        } else if (Type === 'ITEM') {
            borrowing = await prisma.Borrow_Item.findUnique({ where: { Borrow_Item_ID: parseInt(id) } });
            if (!borrowing) return res.status(404).json({ error: 'Borrowing record not found' });

            updateData = await prisma.Borrow_Item.update({
                where: { Borrow_Item_ID: parseInt(id) },
                data: { Status, Updated_At: new Date() }
            });

            await prisma.Item.update({
                where: { Item_ID: borrowing.Item_ID },
                data: { Status: 'AVAILABLE' }
            });

        } else {
            return res.status(400).json({ error: 'Invalid Type. Must be COMPUTER or ITEM.' });
        }

        res.json(updateData);

    } catch (error) {
        console.error('Return error:', error);
        res.status(500).json({ error: 'Failed to process return', details: error.message });
    }
});

module.exports = router;
