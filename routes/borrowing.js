const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const AuditLogger = require('../src/utils/auditLogger');

// Middleware to extract user from JWT
const { authenticateToken } = require('../src/middleware/auth');
const { asyncHandler } = require('../src/middleware/errorHandler');

// Borrow endpoint
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
    const { items, purpose, expectedReturnDate } = req.body;
    const user = req.user;
    const now = new Date();

    // Default return date if not provided (e.g. end of day or 2 hours)
    const retDate = expectedReturnDate ? new Date(expectedReturnDate) : new Date(now.getTime() + 2 * 60 * 60 * 1000);

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items array is required' });
    }

    const borrowings = [];
    const errors = [];

    // Process each item
    for (const itemReq of items) {
        try {
            const itemId = itemReq.itemId || itemReq.Item_ID; // Handle mixed casing/naming
            if (!itemId) continue;

            // Check item availability
            const item = await prisma.Item.findUnique({ where: { Item_ID: parseInt(itemId) } });

            if (!item) {
                errors.push(`Item ID ${itemId} not found`);
                continue;
            }

            if (item.Status !== 'AVAILABLE') {
                errors.push(`Item ${item.Item_Code} (${item.Name || item.Item_Type}) is not available`);
                continue;
            }

            // Create borrowing record
            const lender = await prisma.User.findFirst({ where: { User_Role: { in: ['ADMIN', 'LAB_HEAD', 'LAB_TECH'] } } });

            const borrowing = await prisma.Borrow_Item.create({
                data: {
                    Borrower_ID: user.User_ID,
                    Borrowee_ID: lender ? lender.User_ID : user.User_ID, // System/Tech assigns it
                    Item_ID: parseInt(itemId),
                    Borrow_Date: now,
                    Return_Date: retDate,
                    Status: 'BORROWED'
                },
                include: { Item: true }
            });

            // Update item status
            await prisma.Item.update({
                where: { Item_ID: parseInt(itemId) },
                data: { Status: 'BORROWED' }
            });

            // Log
            await AuditLogger.logBorrowing(
                user.User_ID,
                'ITEM_BORROWED',
                `${user.First_Name} ${user.Last_Name} borrowed ${item.Name || item.Item_Type} (${item.Item_Code})`,
                'LAB_TECH'
            );

            borrowings.push(borrowing);

        } catch (err) {
            console.error(`Error processing item ${itemReq.itemId}:`, err);
            errors.push(`Failed to process item ${itemReq.itemId}: ${err.message}`);
        }
    }

    if (borrowings.length === 0 && errors.length > 0) {
        return res.status(400).json({ error: 'Failed to borrow items', details: errors });
    }

    res.status(201).json({
        success: true,
        message: `Successfully borrowed ${borrowings.length} items`,
        borrowings,
        errors: errors.length > 0 ? errors : undefined
    });
}));

// Return endpoint
router.patch('/:id/return', authenticateToken, asyncHandler(async (req, res) => {
    const { status, remarks } = req.body;
    const { id } = req.params;

    const borrowing = await prisma.Borrow_Item.findUnique({
        where: { Borrow_Item_ID: parseInt(id) },
        include: { Item: true, Borrower: true }
    });

    if (!borrowing) {
        return res.status(404).json({ error: 'Borrowing record not found' });
    }

    const userId = borrowing.Borrower_ID;
    const itemName = borrowing.Item.Name || borrowing.Item.Item_Code;

    await prisma.Borrow_Item.update({
        where: { Borrow_Item_ID: parseInt(id) },
        data: {
            Status: status || 'RETURNED',
            Return_Date: new Date(),
            Updated_At: new Date()
        }
    });

    await prisma.Item.update({
        where: { Item_ID: borrowing.Item_ID },
        data: { Status: 'AVAILABLE' }
    });

    // Log Event
    await AuditLogger.logBorrowing(
        userId,
        'ITEM_RETURNED',
        `${borrowing.Borrower.First_Name} ${borrowing.Borrower.Last_Name} returned ${itemName}`,
        'LAB_TECH'
    );

    res.json({ message: 'Item returned successfully' });
}));

module.exports = router;
