const prisma = require('../../lib/prisma');

const VALID_COMPUTER_STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'DECOMMISSIONED'];

const buildComputerInclude = () => ({
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
});

// GET /api/computers - Fetch all computers (optionally filtered by roomId)
const getComputers = async (req, res) => {
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

        res.json({ success: true, data: computers });
    } catch (error) {
        console.error('Error fetching computers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch computers' });
    }
};

// POST /api/computers - Create a new computer
const createComputer = async (req, res) => {
    try {
        const { name, roomId, status, items } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Computer name is required' });
        }

        const normalizedStatus = status || 'AVAILABLE';
        if (!VALID_COMPUTER_STATUSES.includes(normalizedStatus)) {
            return res.status(400).json({ success: false, error: 'Invalid computer status' });
        }

        const parsedRoomId = roomId === undefined || roomId === null || roomId === ''
            ? null
            : parseInt(roomId, 10);

        if (parsedRoomId !== null && Number.isNaN(parsedRoomId)) {
            return res.status(400).json({ success: false, error: 'Invalid room ID' });
        }

        const incomingItems = Array.isArray(items) ? items : [];
        const itemIds = incomingItems
            .filter(item => item?.itemId)
            .map(item => parseInt(item.itemId, 10));

        if (itemIds.some(Number.isNaN)) {
            return res.status(400).json({ success: false, error: 'Invalid item selected' });
        }

        if (new Set(itemIds).size !== itemIds.length) {
            return res.status(400).json({ success: false, error: 'Duplicate component selected' });
        }

        const updatedComputer = await prisma.$transaction(async (tx) => {
            if (parsedRoomId !== null) {
                const room = await tx.room.findUnique({ where: { Room_ID: parsedRoomId } });
                if (!room) {
                    const error = new Error('Room not found');
                    error.statusCode = 404;
                    throw error;
                }
            }

            const itemsToConnect = [];
            const itemsToCreate = [];

            if (itemIds.length > 0) {
                const foundItems = await tx.item.findMany({
                    where: { Item_ID: { in: itemIds } },
                    include: {
                        Computer: { select: { Computer_ID: true, Name: true } }
                    }
                });

                if (foundItems.length !== itemIds.length) {
                    const error = new Error('One or more selected components no longer exist');
                    error.statusCode = 400;
                    throw error;
                }

                for (const requestedItem of incomingItems.filter(item => item?.itemId)) {
                    const itemId = parseInt(requestedItem.itemId, 10);
                    const foundItem = foundItems.find(item => item.Item_ID === itemId);

                    if (foundItem.Status !== 'AVAILABLE') {
                        const error = new Error(`${foundItem.Brand || foundItem.Item_Code} is not available`);
                        error.statusCode = 400;
                        throw error;
                    }

                    if (foundItem.Computer.length > 0) {
                        const error = new Error(`${foundItem.Brand || foundItem.Item_Code} is already assigned to ${foundItem.Computer[0].Name}`);
                        error.statusCode = 400;
                        throw error;
                    }

                    if (requestedItem.itemType && foundItem.Item_Type !== requestedItem.itemType) {
                        const error = new Error(`${foundItem.Item_Code} is not a ${requestedItem.itemType.replace('_', ' ').toLowerCase()}`);
                        error.statusCode = 400;
                        throw error;
                    }

                    itemsToConnect.push({ Item_ID: itemId });
                }
            }

            for (const item of incomingItems) {
                if (!item.itemId && (item.brand || item.serialNumber)) {
                    const itemCode = `${item.itemType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                    itemsToCreate.push({
                        Item_Code: itemCode,
                        Item_Type: item.itemType,
                        Brand: item.brand || null,
                        Serial_Number: item.serialNumber || null,
                        Status: 'AVAILABLE',
                        Room_ID: parsedRoomId,
                        IsBorrowable: false,
                    });
                }
            }

            const computer = await tx.computer.create({
                data: {
                    Name: name.trim(),
                    Room_ID: parsedRoomId,
                    Status: normalizedStatus,
                    Updated_At: new Date(),
                    Item: {
                        ...(itemsToConnect.length > 0 && { connect: itemsToConnect }),
                        ...(itemsToCreate.length > 0 && { create: itemsToCreate })
                    }
                },
                include: buildComputerInclude()
            });

            if (itemIds.length > 0) {
                await tx.item.updateMany({
                    where: { Item_ID: { in: itemIds } },
                    data: {
                        Room_ID: parsedRoomId,
                        IsBorrowable: false
                    }
                });
            }

            return computer;
        });

        res.status(201).json({ success: true, data: updatedComputer });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('Error creating computer:', error);
        res.status(statusCode).json({
            success: false,
            error: statusCode === 500 ? 'Failed to create computer' : error.message
        });
    }
};

// PUT /api/computers/:id - Update a computer
const updateComputer = async (req, res) => {
    try {
        const computerId = parseInt(req.params.id);
        const { name, roomId, status, items } = req.body;

        // Update computer basic info
        const updateData = {};
        if (name !== undefined) updateData.Name = name.trim();
        if (roomId !== undefined) updateData.Room_ID = roomId;
        if (status !== undefined) updateData.Status = status;
        updateData.Updated_At = new Date();

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
                            Status: 'AVAILABLE',
                            Room_ID: computer.Room_ID || null,
                            IsBorrowable: false,
                            Computer: {
                                connect: { Computer_ID: computerId }
                            }
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

        res.json({ success: true, data: updatedComputer });
    } catch (error) {
        console.error('Error updating computer:', error);
        res.status(500).json({ success: false, error: 'Failed to update computer' });
    }
};

// DELETE /api/computers/:id - Delete a computer
const deleteComputer = async (req, res) => {
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

        res.json({ success: true, data: { message: 'Computer deleted successfully' } });
    } catch (error) {
        console.error('Error deleting computer:', error);
        res.status(500).json({ success: false, error: 'Failed to delete computer' });
    }
};

module.exports = {
    getComputers,
    createComputer,
    updateComputer,
    deleteComputer
};
