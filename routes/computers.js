const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prisma');
const { authenticateToken } = require('../src/middleware/auth');

// GET /api/computers - Fetch all computers (optionally filtered by roomId)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.query;

        const where = {};
        if (roomId) {
            where.Room_ID = parseInt(roomId);
        }

        const computers = await prisma.computer.findMany({
            where,
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true,
                        Room_Type: true,
                    }
                },
                Item: {
                    select: {
                        Item_ID: true,
                        Item_Code: true,
                        Item_Type: true,
                        Brand: true,
                        Serial_Number: true,
                        Status: true,
                    }
                }
            },
            orderBy: { Name: 'asc' }
        });

        res.json(computers);
    } catch (error) {
        console.error('Error fetching computers:', error);
        res.status(500).json({
            error: 'Failed to fetch computers',
            details: error.message
        });
    }
});

// POST /api/computers - Create a new computer
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, roomId, status, items } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Computer name is required' });
        }

        // Create computer with items
        const computer = await prisma.computer.create({
            data: {
                Name: name.trim(),
                Room_ID: roomId || null,
                Status: status || 'AVAILABLE',
            },
            include: {
                Room: true,
                Item: true,
            }
        });

        // Link or create items
        if (items && items.length > 0) {
            const itemsToConnect = [];
            const itemsToCreate = [];

            for (const item of items) {
                if (item.itemId) {
                    // Link existing item to this computer
                    itemsToConnect.push({ Item_ID: item.itemId });
                    // Update item status to IN_USE
                    await prisma.item.update({
                        where: { Item_ID: item.itemId },
                        data: { Status: 'IN_USE' }
                    });
                } else if (item.brand || item.serialNumber) {
                    // Create new item (legacy support - deprecated)
                    const itemCode = `${item.itemType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                    itemsToCreate.push({
                        Item_Code: itemCode,
                        Item_Type: item.itemType,
                        Brand: item.brand || null,
                        Serial_Number: item.serialNumber || null,
                        Status: 'IN_USE',
                        Room_ID: roomId || null,
                        IsBorrowable: false,
                    });
                }
            }

            // Connect existing items and create new ones in a single update
            if (itemsToConnect.length > 0 || itemsToCreate.length > 0) {
                await prisma.computer.update({
                    where: { Computer_ID: computer.Computer_ID },
                    data: {
                        Item: {
                            ...(itemsToConnect.length > 0 && { connect: itemsToConnect }),
                            ...(itemsToCreate.length > 0 && { create: itemsToCreate })
                        }
                    }
                });
            }
        }

        // Fetch updated computer with items
        const updatedComputer = await prisma.computer.findUnique({
            where: { Computer_ID: computer.Computer_ID },
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true,
                        Room_Type: true,
                    }
                },
                Item: {
                    select: {
                        Item_ID: true,
                        Item_Code: true,
                        Item_Type: true,
                        Brand: true,
                        Serial_Number: true,
                        Status: true,
                    }
                }
            }
        });

        res.status(201).json(updatedComputer);
    } catch (error) {
        console.error('Error creating computer:', error);
        res.status(500).json({
            error: 'Failed to create computer',
            details: error.message
        });
    }
});

// PUT /api/computers/:id - Update a computer
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const computerId = parseInt(req.params.id);
        const { name, roomId, status, items } = req.body;

        // Update computer basic info
        const updateData = {};
        if (name !== undefined) updateData.Name = name.trim();
        if (roomId !== undefined) updateData.Room_ID = roomId;
        if (status !== undefined) updateData.Status = status;

        const computer = await prisma.computer.update({
            where: { Computer_ID: computerId },
            data: updateData,
        });

        // Update items if provided
        if (items && items.length > 0) {
            for (const item of items) {
                if (item.itemId) {
                    // Update existing item
                    const updateItemData = {};
                    if (item.brand !== undefined) updateItemData.Brand = item.brand;
                    if (item.serialNumber !== undefined) updateItemData.Serial_Number = item.serialNumber;
                    if (item.status !== undefined) updateItemData.Status = item.status;

                    await prisma.item.update({
                        where: { Item_ID: item.itemId },
                        data: updateItemData
                    });
                } else if (item.brand || item.serialNumber) {
                    // Create new item for this computer
                    const itemCode = `${item.itemType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                    await prisma.item.create({
                        data: {
                            Item_Code: itemCode,
                            Item_Type: item.itemType,
                            Brand: item.brand || null,
                            Serial_Number: item.serialNumber || null,
                            Status: 'IN_USE',
                            Computer_ID: computerId,
                            Room_ID: computer.Room_ID || null,
                            IsBorrowable: false,
                        }
                    });
                }
            }
        }

        // Fetch updated computer
        const updatedComputer = await prisma.computer.findUnique({
            where: { Computer_ID: computerId },
            include: {
                Room: {
                    select: {
                        Room_ID: true,
                        Name: true,
                        Room_Type: true,
                    }
                },
                Item: {
                    select: {
                        Item_ID: true,
                        Item_Code: true,
                        Item_Type: true,
                        Brand: true,
                        Serial_Number: true,
                        Status: true,
                    }
                }
            }
        });

        res.json(updatedComputer);
    } catch (error) {
        console.error('Error updating computer:', error);
        res.status(500).json({
            error: 'Failed to update computer',
            details: error.message
        });
    }
});

// DELETE /api/computers/:id - Delete a computer
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const computerId = parseInt(req.params.id);

        // First, get all items linked to this computer
        const computer = await prisma.computer.findUnique({
            where: { Computer_ID: computerId },
            include: { Item: true }
        });

        // Disconnect items and set status back to AVAILABLE
        if (computer && computer.Item.length > 0) {
            await prisma.computer.update({
                where: { Computer_ID: computerId },
                data: {
                    Item: {
                        disconnect: computer.Item.map(item => ({ Item_ID: item.Item_ID }))
                    }
                }
            });

            // Update items status to AVAILABLE
            await prisma.item.updateMany({
                where: {
                    Item_ID: { in: computer.Item.map(item => item.Item_ID) }
                },
                data: { Status: 'AVAILABLE' }
            });
        }

        // Delete the computer
        await prisma.computer.delete({
            where: { Computer_ID: computerId }
        });

        res.json({ message: 'Computer deleted successfully' });
    } catch (error) {
        console.error('Error deleting computer:', error);
        res.status(500).json({
            error: 'Failed to delete computer',
            details: error.message
        });
    }
});

module.exports = router;
