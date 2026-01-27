const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prisma');
const { authenticateToken } = require('../src/middleware/auth');
const { authorize, ROLES } = require('../src/middleware/authorize');
const { asyncHandler } = require('../src/middleware/errorHandler');
const AuditLogger = require('../src/utils/auditLogger');
const NotificationManager = require('../src/services/notificationManager');

// ============================================
// GET /api/borrowing - List borrowing requests
// ============================================
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    const { status, role } = req.query;
    const user = req.user;

    let whereClause = {};

    // Filter by status if provided
    if (status) {
        whereClause.Status = status.toUpperCase();
    }

    // Filter by role: 'borrower' shows user's own requests, 'approver' shows all pending
    if (role === 'borrower') {
        whereClause.Borrower_ID = user.User_ID;
    }

    const borrowings = await prisma.borrow_Item.findMany({
        where: whereClause,
        include: {
            Item: true,
            Borrower: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true,
                    Email: true,
                    User_Role: true
                }
            },
            Borrowee: {
                select: {
                    User_ID: true,
                    First_Name: true,
                    Last_Name: true
                }
            },
            Room: true
        },
        orderBy: { Created_At: 'desc' }
    });

    res.json(borrowings);
}));

// ============================================
// POST /api/borrowing - Request to borrow items
// ============================================
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
    const { itemType, purpose, borrowDate, expectedReturnDate, items } = req.body;
    const user = req.user;
    const now = new Date();

    // Use requested borrow date or default to now
    const startDate = borrowDate ? new Date(borrowDate) : now;

    // Default return date: 2 hours from now/start date
    const retDate = expectedReturnDate
        ? new Date(expectedReturnDate)
        : new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

    // Support both new (itemType) and legacy (items array) formats
    if (itemType) {
        // NEW: Faculty requests by item TYPE only
        const borrowing = await prisma.borrow_Item.create({
            data: {
                Borrower_ID: user.User_ID,
                Borrowee_ID: user.User_ID, // Will be updated when approved
                Item_ID: null, // Will be assigned by Lab Tech during approval
                Requested_Item_Type: itemType,
                Purpose: purpose || '',
                Borrow_Date: startDate,
                Return_Date: retDate,
                Status: 'PENDING'
            }
        });

        // Log the request and notify Lab Techs/Heads
        await AuditLogger.logBorrowing(
            user.User_ID,
            'BORROW_REQUESTED',
            `${user.First_Name} ${user.Last_Name} requested to borrow a ${itemType}`,
            ['LAB_TECH', 'LAB_HEAD']
        );

        return res.status(201).json({
            success: true,
            message: 'Borrow request submitted. Awaiting Lab Tech approval.',
            borrowing
        });
    }

    // LEGACY: Specific item(s) request (for backward compatibility)
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Either itemType or items array is required' });
    }

    const borrowings = [];
    const errors = [];

    for (const itemReq of items) {
        try {
            const itemId = itemReq.itemId || itemReq.Item_ID;
            if (!itemId) continue;

            // Check item exists and is available
            const item = await prisma.item.findUnique({
                where: { Item_ID: parseInt(itemId) }
            });

            if (!item) {
                errors.push(`Item ID ${itemId} not found`);
                continue;
            }

            if (item.Status !== 'AVAILABLE') {
                errors.push(`Item ${item.Item_Code} (${item.Name || item.Item_Type}) is not available`);
                continue;
            }

            // Create borrowing request with PENDING status
            const borrowing = await prisma.borrow_Item.create({
                data: {
                    Borrower_ID: user.User_ID,
                    Borrowee_ID: user.User_ID, // Will be updated when approved
                    Item_ID: parseInt(itemId),
                    Requested_Item_Type: item.Item_Type,
                    Purpose: purpose || '',
                    Borrow_Date: startDate,
                    Return_Date: retDate,
                    Status: 'PENDING' // Start as PENDING, not BORROWED
                },
                include: { Item: true }
            });

            // Log the request and notify Lab Techs/Heads (AuditLogger handles notifications)
            await AuditLogger.logBorrowing(
                user.User_ID,
                'BORROW_REQUESTED',
                `${user.First_Name} ${user.Last_Name} requested to borrow ${item.Name || item.Item_Type} (${item.Item_Code})`,
                ['LAB_TECH', 'LAB_HEAD'] // Notify both roles
            );

            borrowings.push(borrowing);

        } catch (err) {
            console.error(`Error processing item ${itemReq.itemId}:`, err);
            errors.push(`Failed to process item ${itemReq.itemId}: ${err.message}`);
        }
    }

    if (borrowings.length === 0 && errors.length > 0) {
        return res.status(400).json({ error: 'Failed to create borrow requests', details: errors });
    }

    res.status(201).json({
        success: true,
        message: `Created ${borrowings.length} borrow request(s). Awaiting Lab Tech approval.`,
        borrowings,
        errors: errors.length > 0 ? errors : undefined
    });
}));

// ============================================
// PATCH /api/borrowing/:id/approve - Approve a borrow request
// ============================================
router.patch('/:id/approve',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { assignedItemId } = req.body; // Lab Tech can assign specific item
        const approver = req.user;

        const borrowing = await prisma.borrow_Item.findUnique({
            where: { Borrow_Item_ID: parseInt(id) },
            include: { Item: true, Borrower: true }
        });

        if (!borrowing) {
            return res.status(404).json({ error: 'Borrow request not found' });
        }

        if (borrowing.Status !== 'PENDING') {
            return res.status(400).json({
                error: `Cannot approve. Current status is ${borrowing.Status}`
            });
        }

        // Determine the item ID to use
        let itemId = borrowing.Item_ID;
        let item = borrowing.Item;

        // If no item assigned yet (faculty requested by type), require assignedItemId
        if (!itemId) {
            if (!assignedItemId) {
                return res.status(400).json({
                    error: 'Please select a specific item to assign to this request'
                });
            }
            itemId = parseInt(assignedItemId);

            // Fetch the assigned item
            item = await prisma.item.findUnique({
                where: { Item_ID: itemId }
            });

            if (!item) {
                return res.status(404).json({ error: 'Assigned item not found' });
            }

            // Verify item matches requested type
            if (borrowing.Requested_Item_Type && item.Item_Type !== borrowing.Requested_Item_Type) {
                return res.status(400).json({
                    error: `Item type mismatch. Requested: ${borrowing.Requested_Item_Type}, Provided: ${item.Item_Type}`
                });
            }
        } else if (assignedItemId && assignedItemId !== borrowing.Item_ID) {
            // Lab Tech wants to reassign to a different item
            itemId = parseInt(assignedItemId);
            item = await prisma.item.findUnique({
                where: { Item_ID: itemId }
            });
            if (!item) {
                return res.status(404).json({ error: 'Assigned item not found' });
            }
        }

        // Check if item is still available
        if (item.Status !== 'AVAILABLE') {
            return res.status(409).json({
                error: `Item ${item.Item_Code || item.Item_Type} is no longer available`
            });
        }

        // Approve and mark as borrowed, assign the item
        const updatedBorrowing = await prisma.borrow_Item.update({
            where: { Borrow_Item_ID: parseInt(id) },
            data: {
                Status: 'BORROWED',
                Item_ID: itemId,
                Borrowee_ID: approver.User_ID // Lab Tech who approved
            },
            include: { Item: true, Borrower: true }
        });

        // Update item status
        await prisma.item.update({
            where: { Item_ID: itemId },
            data: { Status: 'BORROWED' }
        });

        // Log the approval
        const itemName = item.Name || item.Item_Type || item.Item_Code;
        await AuditLogger.logBorrowing(
            approver.User_ID,
            'BORROW_APPROVED',
            `${approver.First_Name} ${approver.Last_Name} approved borrow request for ${itemName} by ${borrowing.Borrower.First_Name} ${borrowing.Borrower.Last_Name}`,
            null,
            borrowing.Borrower_ID // Notify the requester
        );

        // Real-time notification to requester
        NotificationManager.send(borrowing.Borrower_ID, {
            type: 'BORROW_APPROVED',
            category: 'BORROWING_UPDATE',
            timestamp: new Date().toISOString(),
            message: `Your request to borrow ${itemName} has been approved!`,
            borrowing: {
                id: borrowing.Borrow_Item_ID,
                itemId: itemId,
                status: 'BORROWED'
            }
        });

        res.json({
            success: true,
            message: `Approved borrow request for ${itemName}`,
            borrowing: updatedBorrowing
        });
    })
);

// ============================================
// PATCH /api/borrowing/:id/reject - Reject a borrow request
// ============================================
router.patch('/:id/reject',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { reason } = req.body;
        const approver = req.user;

        const borrowing = await prisma.borrow_Item.findUnique({
            where: { Borrow_Item_ID: parseInt(id) },
            include: { Item: true, Borrower: true }
        });

        if (!borrowing) {
            return res.status(404).json({ error: 'Borrow request not found' });
        }

        if (borrowing.Status !== 'PENDING') {
            return res.status(400).json({
                error: `Cannot reject. Current status is ${borrowing.Status}`
            });
        }

        // Reject the request
        const updatedBorrowing = await prisma.borrow_Item.update({
            where: { Borrow_Item_ID: parseInt(id) },
            data: {
                Status: 'REJECTED',
                Borrowee_ID: approver.User_ID
            },
            include: { Item: true, Borrower: true }
        });

        // Log the rejection
        const itemName = borrowing.Item.Name || borrowing.Item.Item_Code;
        await AuditLogger.logBorrowing(
            approver.User_ID,
            'BORROW_REJECTED',
            `${approver.First_Name} ${approver.Last_Name} rejected borrow request for ${itemName}${reason ? `: ${reason}` : ''}`,
            null,
            borrowing.Borrower_ID
        );

        // Notify requester
        NotificationManager.send(borrowing.Borrower_ID, {
            type: 'BORROW_REJECTED',
            category: 'BORROWING_UPDATE',
            timestamp: new Date().toISOString(),
            message: `Your request to borrow ${itemName} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
            borrowing: {
                id: borrowing.Borrow_Item_ID,
                itemId: borrowing.Item_ID,
                status: 'REJECTED'
            }
        });

        res.json({
            success: true,
            message: `Rejected borrow request for ${itemName}`,
            borrowing: updatedBorrowing
        });
    })
);

// ============================================
// PATCH /api/borrowing/:id/return - Return a borrowed item
// ============================================
router.patch('/:id/return', authenticateToken, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { condition, remarks } = req.body;
    const user = req.user;

    const borrowing = await prisma.borrow_Item.findUnique({
        where: { Borrow_Item_ID: parseInt(id) },
        include: { Item: true, Borrower: true }
    });

    if (!borrowing) {
        return res.status(404).json({ error: 'Borrowing record not found' });
    }

    if (borrowing.Status !== 'BORROWED' && borrowing.Status !== 'OVERDUE') {
        return res.status(400).json({
            error: `Cannot return. Current status is ${borrowing.Status}`
        });
    }

    // Update borrowing record
    await prisma.borrow_Item.update({
        where: { Borrow_Item_ID: parseInt(id) },
        data: {
            Status: 'RETURNED',
            Return_Date: new Date()
        }
    });

    // Update item status based on condition
    const newItemStatus = condition === 'DEFECTIVE' ? 'DEFECTIVE' : 'AVAILABLE';
    await prisma.item.update({
        where: { Item_ID: borrowing.Item_ID },
        data: { Status: newItemStatus }
    });

    // Log the return
    const itemName = borrowing.Item.Name || borrowing.Item.Item_Code;
    await AuditLogger.logBorrowing(
        user.User_ID,
        'ITEM_RETURNED',
        `${borrowing.Borrower.First_Name} ${borrowing.Borrower.Last_Name} returned ${itemName}${remarks ? ` (${remarks})` : ''}`,
        'LAB_TECH'
    );

    res.json({
        success: true,
        message: `Item ${itemName} returned successfully`
    });
}));

// ============================================
// GET /api/borrowing/pending/count - Get count of pending requests
// ============================================
router.get('/pending/count',
    authenticateToken,
    authorize('LAB_TECH', 'LAB_HEAD', 'ADMIN'),
    asyncHandler(async (req, res) => {
        const count = await prisma.borrow_Item.count({
            where: { Status: 'PENDING' }
        });
        res.json({ count });
    })
);

module.exports = router;
