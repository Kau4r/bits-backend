const prisma = require('../../lib/prisma');

const VALID_COMPUTER_STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'DECOMMISSIONED'];

const extractPcNumber = (name = '') => {
    if (typeof name !== 'string') return null;

    const pcMatch = name.match(/\b(?:PC|COMPUTER)\s*[-#:]*\s*(\d+)\b/i);
    if (pcMatch) return parseInt(pcMatch[1], 10);

    const trailingNumber = name.match(/(\d+)\s*$/);
    return trailingNumber ? parseInt(trailingNumber[1], 10) : null;
};

const compareComputersForRoomDisplay = (a, b) => {
    const aNumber = extractPcNumber(a.Name);
    const bNumber = extractPcNumber(b.Name);

    if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
        return aNumber - bNumber;
    }

    if (aNumber !== null && bNumber === null) return -1;
    if (aNumber === null && bNumber !== null) return 1;

    const aCreatedAt = a.Created_At ? new Date(a.Created_At).getTime() : 0;
    const bCreatedAt = b.Created_At ? new Date(b.Created_At).getTime() : 0;
    if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;

    return (a.Computer_ID || 0) - (b.Computer_ID || 0);
};

const decorateComputersForRoomDisplay = (computers) => {
    const groups = new Map();

    for (const computer of computers) {
        const key = computer.Room_ID ?? 'unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(computer);
    }

    const decorated = [];
    for (const group of groups.values()) {
        const sortedGroup = [...group].sort(compareComputersForRoomDisplay);
        sortedGroup.forEach((computer, index) => {
            decorated.push({
                ...computer,
                Display_Number: index + 1,
                Display_Name: `PC ${index + 1}`,
            });
        });
    }

    return decorated.sort((a, b) => {
        const roomCompare = (a.Room_ID || 0) - (b.Room_ID || 0);
        if (roomCompare !== 0) return roomCompare;
        return (a.Display_Number || 0) - (b.Display_Number || 0);
    });
};

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
            const parsedRoomId = parseInt(roomId, 10);
            if (Number.isNaN(parsedRoomId)) {
                return res.status(400).json({ success: false, error: 'Invalid room ID' });
            }
            where.Room_ID = parsedRoomId;
        }

        const computers = await prisma.computer.findMany({
            where,
            include: buildComputerInclude(),
            orderBy: [
                { Room_ID: 'asc' },
                { Created_At: 'asc' },
                { Computer_ID: 'asc' },
            ]
        });

        res.json({ success: true, data: decorateComputersForRoomDisplay(computers) });
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
        const computerId = parseInt(req.params.id, 10);
        const { name, roomId, status, items } = req.body;

        if (Number.isNaN(computerId)) {
            return res.status(400).json({ success: false, error: 'Invalid computer ID' });
        }

        const updateData = {};
        if (name !== undefined) {
            if (!name || !name.trim()) {
                return res.status(400).json({ success: false, error: 'Computer name is required' });
            }
            updateData.Name = name.trim();
        }

        let parsedRoomId;
        if (roomId !== undefined) {
            parsedRoomId = roomId === null || roomId === ''
                ? null
                : parseInt(roomId, 10);

            if (parsedRoomId !== null && Number.isNaN(parsedRoomId)) {
                return res.status(400).json({ success: false, error: 'Invalid room ID' });
            }
            updateData.Room_ID = parsedRoomId;
        }

        if (status !== undefined) {
            if (!VALID_COMPUTER_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid computer status' });
            }
            updateData.Status = status;
        }

        updateData.Updated_At = new Date();

        const updatedComputer = await prisma.$transaction(async (tx) => {
            const existingComputer = await tx.computer.findUnique({
                where: { Computer_ID: computerId },
                include: { Item: true }
            });

            if (!existingComputer) {
                const error = new Error('Computer not found');
                error.statusCode = 404;
                throw error;
            }

            if (parsedRoomId !== undefined && parsedRoomId !== null) {
                const room = await tx.room.findUnique({ where: { Room_ID: parsedRoomId } });
                if (!room) {
                    const error = new Error('Room not found');
                    error.statusCode = 404;
                    throw error;
                }
            }

            const computer = await tx.computer.update({
                where: { Computer_ID: computerId },
                data: updateData,
            });

            if (roomId !== undefined && existingComputer.Item.length > 0) {
                await tx.item.updateMany({
                    where: {
                        Item_ID: { in: existingComputer.Item.map(item => item.Item_ID) }
                    },
                    data: { Room_ID: parsedRoomId }
                });
            }

            if (Array.isArray(items) && items.length > 0) {
                for (const item of items) {
                    if (item.itemId) {
                        const updateItemData = {};
                        if (item.brand !== undefined) updateItemData.Brand = item.brand;
                        if (item.serialNumber !== undefined) updateItemData.Serial_Number = item.serialNumber;
                        if (item.status !== undefined) updateItemData.Status = item.status;

                        if (Object.keys(updateItemData).length > 0) {
                            await tx.item.update({
                                where: { Item_ID: item.itemId },
                                data: updateItemData
                            });
                        }
                    } else if (item.brand || item.serialNumber) {
                        const itemCode = `${item.itemType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                        await tx.item.create({
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

            return tx.computer.findUnique({
                where: { Computer_ID: computerId },
                include: buildComputerInclude()
            });
        });

        res.json({ success: true, data: updatedComputer });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('Error updating computer:', error);
        res.status(statusCode).json({
            success: false,
            error: statusCode === 500 ? 'Failed to update computer' : error.message
        });
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
