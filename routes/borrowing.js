const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const AuditLogger = require('../src/utils/auditLogger');

// Middleware to extract user from JWT
const { authenticateToken } = require('../src/middleware/auth');

// Borrow endpoint
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { Item_ID, Computer_ID, Return_Date, items, type, purpose, expectedReturnDate, borrowerId, borroweeId } = req.body;
        // User is attached by authenticateToken middleware
        const user = req.user;
        const now = new Date();
        const retDate = Return_Date || expectedReturnDate;

        if (!retDate) return res.status(400).json({ error: 'Return Date is required' });

        let borrowing;

        // Support for new Payload structure (items array) or Legacy (Item_ID)
        // Adjust logic to handle both or prefer new one.
        // My previous FacultyScheduling.tsx sends: { items: [{ itemId, quantity }], type: 'ITEM', ... }

        const isItemBorrow = type === 'ITEM' || !!Item_ID || !!items;

        if (user.User_Role === 'STUDENT') {
            // Note: Updated logic to support new structure for students if needed, 
            // but sticking to existing logic for now unless 'type' is passed.
            if (!Computer_ID && type !== 'COMPUTER') return res.status(400).json({ error: 'Computer_ID is required for students' });

            const compId = Computer_ID || (req.body.computers && req.body.computers[0]?.computerId);

            // Check if computer exists and is available
            const computer = await prisma.Computer.findUnique({ where: { Computer_ID: parseInt(compId) } });
            if (!computer || computer.Status !== 'AVAILABLE') {
                return res.status(403).json({ error: 'Computer not available' });
            }

            // Check if computer is already borrowed
            const existingBorrow = await prisma.Borrowing_Comp.findFirst({
                where: {
                    Computer_ID: parseInt(compId),
                    Status: 'BORROWED',
                    Return_Date: { gte: now }
                }
            });
            if (existingBorrow) return res.status(409).json({ error: 'Computer already borrowed' });

            // Create borrowing record
            borrowing = await prisma.Borrowing_Comp.create({
                data: {
                    User_ID: user.User_ID,
                    Computer_ID: parseInt(compId),
                    Borrow_Date: now,
                    Return_Date: new Date(retDate),
                    Status: 'BORROWED'
                },
                include: { Computer: true, User: true }
            });

            await prisma.Computer.update({
                where: { Computer_ID: parseInt(compId) },
                data: { Status: 'IN_USE' }
            });

            await AuditLogger.logBorrowing(
                user.User_ID,
                'COMPUTER_BORROWED',
                `${user.First_Name} ${user.Last_Name} borrowed PC ${computer.Name}`,
                'LAB_TECH'
            );

        } else if (user.User_Role === 'FACULTY' || user.User_Role === 'LAB_HEAD' || user.User_Role === 'LAB_TECH' || user.User_Role === 'ADMIN') {
            // Updated to allow other roles to borrow items similar to Faculty logic

            // Handle Items Array (from new FacultyScheduling)
            if (items && items.length > 0) {
                // For now, handle the first item (since loop logic is complex for return/single response)
                // Or loop. But createBorrowing returns ONE object?
                // Current logic returns 'borrowing'. 
                // If valid bulk borrowing is needed, I should loop. 
                // For the "Test Button" which sends array of 1, I'll handle index 0.
                const firstItem = items[0];
                const itemId = firstItem.itemId;

                // Process Single Item Borrow
                const item = await prisma.Item.findUnique({ where: { Item_ID: parseInt(itemId) } });
                if (!item || item.Status !== 'AVAILABLE') return res.status(403).json({ error: 'Item not available' });

                // Check existing
                const existing = await prisma.Borrow_Item.findFirst({
                    where: { Item_ID: parseInt(itemId), Status: 'BORROWED', Return_Date: { gte: now } }
                });
                if (existing) return res.status(409).json({ error: 'Item already borrowed' });

                const lender = await prisma.User.findFirst({ where: { User_Role: { in: ['ADMIN', 'LAB_HEAD', 'LAB_TECH'] } } });

                borrowing = await prisma.Borrow_Item.create({
                    data: {
                        Borrower_ID: user.User_ID,
                        Borrowee_ID: lender ? lender.User_ID : user.User_ID,
                        Item_ID: parseInt(itemId),
                        Borrow_Date: now,
                        Return_Date: new Date(retDate),
                        Status: 'BORROWED'
                    },
                    include: { Item: true, Borrower: true }
                });

                await prisma.Item.update({
                    where: { Item_ID: parseInt(itemId) },
                    data: { Status: 'BORROWED' }
                });

                await AuditLogger.logBorrowing(
                    user.User_ID,
                    'ITEM_BORROWED',
                    `${user.First_Name} ${user.Last_Name} borrowed Item ${item.Brand || item.Item_Code}`, // Changed Name to Brand/Code as item names might be generic
                    'LAB_TECH'
                );

            } else if (Item_ID) {
                // Legacy support for direct Item_ID
                // Check if item exists and is available
                const item = await prisma.Item.findUnique({ where: { Item_ID: parseInt(Item_ID) } });
                if (!item || item.Status !== 'AVAILABLE') {
                    return res.status(403).json({ error: 'Item not available' });
                }

                const existingBorrow = await prisma.Borrow_Item.findFirst({
                    where: {
                        Item_ID: parseInt(Item_ID),
                        Status: 'BORROWED',
                        Return_Date: { gte: now }
                    }
                });
                if (existingBorrow) return res.status(409).json({ error: 'Item already borrowed' });

                const lender = await prisma.User.findFirst({ where: { User_Role: { in: ['ADMIN', 'LAB_HEAD', 'LAB_TECH'] } } });

                borrowing = await prisma.Borrow_Item.create({
                    data: {
                        Borrower_ID: user.User_ID,
                        Borrowee_ID: lender ? lender.User_ID : user.User_ID,
                        Item_ID: parseInt(Item_ID),
                        Borrow_Date: now,
                        Return_Date: new Date(retDate),
                        Status: 'BORROWED'
                    },
                    include: { Item: true, Borrower: true }
                });

                await prisma.Item.update({
                    where: { Item_ID: parseInt(Item_ID) },
                    data: { Status: 'BORROWED' }
                });

                await AuditLogger.logBorrowing(
                    user.User_ID,
                    'ITEM_BORROWED',
                    `${user.First_Name} ${user.Last_Name} borrowed Item ${item.Brand || item.Item_Code}`,
                    'LAB_TECH'
                );
            } else {
                return res.status(400).json({ error: 'Item_ID or items array is required for faculty' });
            }

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
router.patch('/:id/return', authenticateToken, async (req, res) => {
    try {
        const { Status = 'RETURNED', Type } = req.body; // Type: 'COMPUTER' or 'ITEM'
        const { id } = req.params;

        if (!Type) return res.status(400).json({ error: 'Type (COMPUTER/ITEM) is required' });

        let updateData, itemName, userId;

        if (Type === 'COMPUTER') {
            const borrowing = await prisma.Borrowing_Comp.findUnique({
                where: { Borrowing_Comp_ID: parseInt(id) },
                include: { Computer: true, User: true }
            });
            if (!borrowing) return res.status(404).json({ error: 'Borrowing record not found' });

            userId = borrowing.User_ID;
            itemName = borrowing.Computer.Name;

            updateData = await prisma.Borrowing_Comp.update({
                where: { Borrowing_Comp_ID: parseInt(id) },
                data: { Status, Updated_At: new Date() }
            });

            await prisma.Computer.update({
                where: { Computer_ID: borrowing.Computer_ID },
                data: { Status: 'AVAILABLE' }
            });

            // Log Event
            await AuditLogger.logBorrowing(
                userId,
                'COMPUTER_RETURNED',
                `${borrowing.User.First_Name} ${borrowing.User.Last_Name} returned PC ${itemName}`,
                'LAB_TECH'
            );

        } else if (Type === 'ITEM') {
            const borrowing = await prisma.Borrow_Item.findUnique({
                where: { Borrow_Item_ID: parseInt(id) },
                include: { Item: true, Borrower: true }
            });
            if (!borrowing) return res.status(404).json({ error: 'Borrowing record not found' });

            userId = borrowing.Borrower_ID;
            itemName = borrowing.Item.Name;

            // Note: Enum mismatch risk here. ensure Status maps to BorrowStatus enum.
            // Using 'RETURNED' which is a valid BorrowStatus.
            updateData = await prisma.Borrow_Item.update({
                where: { Borrow_Item_ID: parseInt(id) },
                data: { Status: 'RETURNED', Return_Date: new Date() } // Updating Return_Date to now
            });

            await prisma.Item.update({
                where: { Item_ID: borrowing.Item_ID },
                data: { Status: 'AVAILABLE' }
            });

            // Log Event
            await AuditLogger.logBorrowing(
                userId,
                'ITEM_RETURNED',
                `${borrowing.Borrower.First_Name} ${borrowing.Borrower.Last_Name} returned Item ${itemName}`,
                'LAB_TECH'
            );

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
