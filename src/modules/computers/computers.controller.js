const prisma = require('../../lib/prisma');
const {
    getRowValue,
    normalizeCsvHeader,
    normalizeImportedStatus,
    parseCsvBuffer,
} = require('../../utils/csvImport');
const { readXlsxWorkbook } = require('../../utils/xlsxReader');

const VALID_COMPUTER_STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'DECOMMISSIONED'];
const VALID_ITEM_STATUSES = ['AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED'];

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

const normalizeImportedItemType = (value = 'OTHER') => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
    if (['GENERAL', '_', '__'].includes(normalized)) return 'OTHER';
    if (normalized === 'SYSTEM_UNIT') return 'MINI_PC';
    if (!normalized || normalized.length > 50 || !/^[A-Z0-9_]+$/.test(normalized)) return null;
    return normalized;
};

const parseRequiredRoomId = (value) => {
    const parsedRoomId = parseInt(value, 10);
    if (Number.isNaN(parsedRoomId) || parsedRoomId <= 0) return { error: 'Room_ID is required for computer import' };
    return { value: parsedRoomId };
};

const isWideRoomAssetsCsv = (headers) => {
    const normalized = headers.map(normalizeCsvHeader);
    return normalized[0] === 'table' &&
        normalized.includes('nuc') &&
        normalized.includes('monitor') &&
        normalized.includes('keyboard') &&
        normalized.includes('mouse');
};

const buildWideRoomAssetComputer = (row) => {
    const tableNumber = row.values[0]?.trim();
    const name = tableNumber ? `PC ${tableNumber}` : '';

    const componentDefinitions = [
        { itemType: 'MINI_PC', itemCode: row.values[1], brand: row.values[2], status: row.values[3] },
        { itemType: 'POWER_ADAPTER', itemCode: row.values[4], serialNumber: row.values[5], status: row.values[6] },
        { itemType: 'MONITOR', itemCode: row.values[7], serialNumber: row.values[8], status: row.values[9] },
        { itemType: 'KEYBOARD', itemCode: row.values[10], serialNumber: row.values[11], status: row.values[12] },
        { itemType: 'MOUSE', itemCode: row.values[13], serialNumber: row.values[14], status: row.values[15] },
    ];

    return {
        name,
        status: 'AVAILABLE',
        items: componentDefinitions
            .filter(item => item.itemCode && item.itemCode.trim())
            .map(item => ({
                itemType: item.itemType,
                itemCode: item.itemCode.trim(),
                brand: item.brand?.trim() || null,
                serialNumber: item.serialNumber?.trim() || null,
                status: normalizeImportedStatus(item.status, VALID_ITEM_STATUSES, 'AVAILABLE'),
            })),
    };
};

const buildNormalizedComputer = (headers, row) => {
    const rawName = getRowValue(headers, row, ['Computer_Name', 'Computer Name', 'Computer', 'Name', 'PC']);
    const tableNumber = getRowValue(headers, row, ['Table', 'PC Number', 'Computer Number']);
    const name = rawName || (tableNumber ? `PC ${tableNumber}` : '');
    const status = normalizeImportedStatus(
        getRowValue(headers, row, ['Status', 'Computer Status']),
        VALID_COMPUTER_STATUSES,
        'AVAILABLE'
    );

    const componentDefinitions = [
        { itemType: 'MINI_PC', aliases: ['Mini PC', 'Mini_PC', 'MiniPC', 'System Unit', 'System_Unit', 'SystemUnit', 'CPU', 'NUC'] },
        { itemType: 'MONITOR', aliases: ['Monitor'] },
        { itemType: 'KEYBOARD', aliases: ['Keyboard'] },
        { itemType: 'MOUSE', aliases: ['Mouse'] },
        { itemType: 'POWER_ADAPTER', aliases: ['Power Adapter', 'Power Adaptor', 'Power_Adapter', 'Power_Adaptor'] },
    ];

    const items = componentDefinitions.flatMap(definition => {
        const normalizedKeys = definition.aliases.map(alias => alias.replace(/\s+/g, '_'));
        const itemCode = getRowValue(headers, row, normalizedKeys.flatMap(key => [
            `${key}_Item_Code`,
            `${key} Item Code`,
            `${key}_Code`,
            `${key} Code`,
            `${key}_Asset_Code`,
            `${key} Asset Code`,
        ]));
        const brand = getRowValue(headers, row, normalizedKeys.flatMap(key => [
            `${key}_Brand`,
            `${key} Brand`,
            `${key}_Model`,
            `${key} Model`,
        ]));
        const serialNumber = getRowValue(headers, row, normalizedKeys.flatMap(key => [
            `${key}_Serial_Number`,
            `${key} Serial Number`,
            `${key}_Serial`,
            `${key} Serial`,
        ]));
        const rawStatus = getRowValue(headers, row, normalizedKeys.flatMap(key => [
            `${key}_Status`,
            `${key} Status`,
            `${key}_Stat`,
            `${key} Stat`,
        ]));

        if (!itemCode && !brand && !serialNumber) return [];

        return [{
            itemType: definition.itemType,
            itemCode: itemCode.trim(),
            brand: brand || null,
            serialNumber: serialNumber || null,
            status: normalizeImportedStatus(rawStatus, VALID_ITEM_STATUSES, 'AVAILABLE'),
        }];
    });

    return { name, status, items };
};

const buildImportedComputer = (headers, row) => {
    const imported = isWideRoomAssetsCsv(headers)
        ? buildWideRoomAssetComputer(row)
        : buildNormalizedComputer(headers, row);

    if (!imported.name.trim()) return { error: 'Missing computer name or table number' };
    if (!imported.status) return { error: 'Invalid computer status' };

    for (const item of imported.items) {
        if (!item.itemCode?.trim()) return { error: `Missing item code for ${item.itemType}` };
        const normalizedItemType = normalizeImportedItemType(item.itemType);
        if (!normalizedItemType) return { error: `Invalid item type: ${item.itemType}` };
        if (!item.status) return { error: `Invalid status for ${item.itemCode || normalizedItemType}` };
        item.itemType = normalizedItemType;
    }

    return {
        computer: {
            name: imported.name.trim(),
            status: imported.status,
            items: imported.items,
        }
    };
};

const parseComputerImportFile = (file, sheetName) => {
    const originalName = file.originalname || '';
    const lowerName = originalName.toLowerCase();

    if (lowerName.endsWith('.csv')) {
        return {
            ...parseCsvBuffer(file.buffer),
            sourceType: 'csv',
        };
    }

    if (lowerName.endsWith('.xlsx')) {
        const workbook = readXlsxWorkbook(file.buffer);
        const sheet = sheetName
            ? workbook.sheets.find(candidate => candidate.name === sheetName)
            : workbook.sheets.find(candidate => candidate.rows.length > 0);

        if (!sheet) {
            const error = new Error(sheetName ? `Sheet "${sheetName}" not found` : 'Workbook has no readable sheets');
            error.statusCode = 400;
            throw error;
        }

        const [headers = [], ...dataRows] = sheet.rows;
        return {
            headers: headers.map(header => String(header || '').trim()),
            rows: dataRows
                .map((values, index) => ({
                    rowNumber: index + 2,
                    values: values.map(value => String(value || '').trim()),
                }))
                .filter(row => row.values.some(value => value !== '')),
            sourceType: 'xlsx',
            sheetName: sheet.name,
        };
    }

    const error = new Error('Only .csv and .xlsx files are supported');
    error.statusCode = 400;
    throw error;
};

const importComputerRow = async (tx, row, roomId, userId) => {
    const existingComputer = await tx.computer.findFirst({
        where: { Name: row.computer.name, Room_ID: roomId },
        select: { Computer_ID: true },
    });
    if (existingComputer) {
        const error = new Error('Computer already exists in this room');
        error.statusCode = 409;
        throw error;
    }

    const itemCodes = row.computer.items
        .map(item => item.itemCode)
        .filter(Boolean);
    if (new Set(itemCodes.map(code => code.toLowerCase())).size !== itemCodes.length) {
        const error = new Error('Duplicate component item code in row');
        error.statusCode = 400;
        throw error;
    }

    const existingItems = itemCodes.length > 0
        ? await tx.item.findMany({
            where: { Item_Code: { in: itemCodes } },
            include: { Computer: { select: { Computer_ID: true, Name: true } } },
        })
        : [];

    const itemsToConnect = [];
    const itemsToCreate = [];

    for (const item of row.computer.items) {
        if (!item.itemCode) continue;

        const existingItem = existingItems.find(existing => existing.Item_Code.toLowerCase() === item.itemCode.toLowerCase());
        if (existingItem) {
            if (existingItem.Computer.length > 0) {
                const error = new Error(`${existingItem.Item_Code} is already assigned to ${existingItem.Computer[0].Name}`);
                error.statusCode = 400;
                throw error;
            }
            if (existingItem.Status !== 'AVAILABLE') {
                const error = new Error(`${existingItem.Item_Code} is not available`);
                error.statusCode = 400;
                throw error;
            }

            itemsToConnect.push({ Item_ID: existingItem.Item_ID });
            continue;
        }

        itemsToCreate.push({
            Item_Code: item.itemCode,
            Item_Type: item.itemType,
            Brand: item.brand || null,
            Serial_Number: item.serialNumber || null,
            Status: item.status || 'AVAILABLE',
            Room_ID: roomId,
            IsBorrowable: false,
            User_ID: userId,
            Created_At: new Date(),
            Updated_At: new Date(),
        });
    }

    const computer = await tx.computer.create({
        data: {
            Name: row.computer.name,
            Room_ID: roomId,
            Status: row.computer.status,
            Updated_At: new Date(),
            Item: {
                ...(itemsToConnect.length > 0 && { connect: itemsToConnect }),
                ...(itemsToCreate.length > 0 && { create: itemsToCreate }),
            },
        },
        include: buildComputerInclude(),
    });

    if (itemsToConnect.length > 0) {
        await tx.item.updateMany({
            where: { Item_ID: { in: itemsToConnect.map(item => item.Item_ID) } },
            data: { Room_ID: roomId, IsBorrowable: false },
        });
    }

    return computer;
};

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
        const { name, roomId, status, items, isTeacher } = req.body;
        const teacherFlag = Boolean(isTeacher);

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

                    if (requestedItem.itemType && normalizeImportedItemType(foundItem.Item_Type) !== normalizeImportedItemType(requestedItem.itemType)) {
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

            const itemRelation = {
                ...(itemsToConnect.length > 0 && { connect: itemsToConnect }),
                ...(itemsToCreate.length > 0 && { create: itemsToCreate })
            };

            const computer = await tx.computer.create({
                data: {
                    Name: name.trim(),
                    Room_ID: parsedRoomId,
                    Status: normalizedStatus,
                    Is_Teacher: teacherFlag,
                    Updated_At: new Date(),
                    ...(Object.keys(itemRelation).length > 0 && { Item: itemRelation })
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

            if (teacherFlag && parsedRoomId !== null) {
                await tx.computer.updateMany({
                    where: {
                        Room_ID: parsedRoomId,
                        Computer_ID: { not: computer.Computer_ID },
                        Is_Teacher: true,
                    },
                    data: { Is_Teacher: false },
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
        const { name, roomId, status, items, isTeacher } = req.body;

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

        if (isTeacher !== undefined) {
            updateData.Is_Teacher = Boolean(isTeacher);
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

            if (updateData.Is_Teacher === true && computer.Room_ID !== null) {
                await tx.computer.updateMany({
                    where: {
                        Room_ID: computer.Room_ID,
                        Computer_ID: { not: computer.Computer_ID },
                        Is_Teacher: true,
                    },
                    data: { Is_Teacher: false },
                });
            }

            if (roomId !== undefined && existingComputer.Item.length > 0) {
                await tx.item.updateMany({
                    where: {
                        Item_ID: { in: existingComputer.Item.map(item => item.Item_ID) }
                    },
                    data: { Room_ID: parsedRoomId }
                });
            }

            if (Array.isArray(items)) {
                const requestedItems = items.filter(item => item?.itemId);
                const requestedItemIds = [...new Set(requestedItems.map(item => parseInt(item.itemId, 10)).filter(id => !Number.isNaN(id)))];
                const existingItemIds = existingComputer.Item.map(item => item.Item_ID);
                const existingItemIdSet = new Set(existingItemIds);

                if (requestedItemIds.length > 0) {
                    const foundItems = await tx.item.findMany({
                        where: { Item_ID: { in: requestedItemIds } },
                        include: { Computer: { select: { Computer_ID: true, Name: true } } },
                    });

                    if (foundItems.length !== requestedItemIds.length) {
                        const error = new Error('One or more selected components no longer exist');
                        error.statusCode = 400;
                        throw error;
                    }

                    for (const requestedItem of requestedItems) {
                        const itemId = parseInt(requestedItem.itemId, 10);
                        const foundItem = foundItems.find(item => item.Item_ID === itemId);
                        const assignedComputer = foundItem.Computer.find(assigned => assigned.Computer_ID !== computerId);

                        if (assignedComputer) {
                            const error = new Error(`${foundItem.Brand || foundItem.Item_Code} is already assigned to ${assignedComputer.Name}`);
                            error.statusCode = 400;
                            throw error;
                        }

                        if (!existingItemIdSet.has(itemId) && foundItem.Status !== 'AVAILABLE') {
                            const error = new Error(`${foundItem.Brand || foundItem.Item_Code} is not available`);
                            error.statusCode = 400;
                            throw error;
                        }

                        if (requestedItem.itemType && normalizeImportedItemType(foundItem.Item_Type) !== normalizeImportedItemType(requestedItem.itemType)) {
                            const error = new Error(`${foundItem.Item_Code} is not a ${requestedItem.itemType.replace('_', ' ').toLowerCase()}`);
                            error.statusCode = 400;
                            throw error;
                        }
                    }
                }

                await tx.computer.update({
                    where: { Computer_ID: computerId },
                    data: {
                        Item: {
                            set: requestedItemIds.map(itemId => ({ Item_ID: itemId })),
                        },
                    },
                });

                const removedItemIds = existingItemIds.filter(itemId => !requestedItemIds.includes(itemId));
                if (removedItemIds.length > 0) {
                    await tx.item.updateMany({
                        where: { Item_ID: { in: removedItemIds } },
                        data: { Status: 'AVAILABLE' },
                    });
                }

                if (requestedItemIds.length > 0) {
                    await tx.item.updateMany({
                        where: { Item_ID: { in: requestedItemIds } },
                        data: {
                            Room_ID: computer.Room_ID || null,
                            IsBorrowable: false,
                        },
                    });
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

// POST /api/computers/import-csv - Import room computers and components from CSV/XLSX
const importComputersCsv = async (req, res) => {
    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ success: false, error: 'CSV or Excel file is required' });
        }

        const parsedRoom = parseRequiredRoomId(req.body.roomId ?? req.query.roomId);
        if (parsedRoom.error) return res.status(400).json({ success: false, error: parsedRoom.error });

        const room = await prisma.room.findUnique({ where: { Room_ID: parsedRoom.value } });
        if (!room) return res.status(400).json({ success: false, error: 'Room not found' });

        const parsed = parseComputerImportFile(req.file, req.body.sheetName ?? req.query.sheetName);
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Import file must include headers and at least one data row' });
        }

        const candidateRows = parsed.rows.map(row => {
            const imported = buildImportedComputer(parsed.headers, row);
            return {
                rowNumber: row.rowNumber,
                computer: imported.computer,
                computerName: imported.computer?.name || '',
                status: imported.error ? 'invalid' : 'valid',
                reason: imported.error || 'Ready to import',
            };
        });

        const seenNames = new Set();
        for (const row of candidateRows.filter(row => row.status === 'valid')) {
            const key = row.computerName.toLowerCase();
            if (seenNames.has(key)) {
                row.status = 'duplicate';
                row.reason = 'Duplicate computer name in CSV';
            }
            seenNames.add(key);
        }

        const createdComputers = [];
        for (const row of candidateRows.filter(row => row.status === 'valid')) {
            try {
                const created = await prisma.$transaction(tx =>
                    importComputerRow(tx, row, parsedRoom.value, req.user.User_ID)
                );
                row.status = 'imported';
                row.reason = 'Imported';
                row.computerId = created.Computer_ID;
                row.componentCount = created.Item.length;
                createdComputers.push(created);
            } catch (error) {
                row.status = error.statusCode === 409 ? 'skipped' : 'invalid';
                row.reason = error.message || 'Failed to import row';
            }
        }

        candidateRows.forEach(row => {
            delete row.computer;
        });

        const summary = {
            totalRows: candidateRows.length,
            imported: candidateRows.filter(row => row.status === 'imported').length,
            skipped: candidateRows.filter(row => row.status === 'skipped').length,
            invalid: candidateRows.filter(row => row.status === 'invalid').length,
            duplicates: candidateRows.filter(row => row.status === 'duplicate').length,
        };

        res.json({
            success: true,
            data: {
                summary,
                rows: candidateRows,
                computers: decorateComputersForRoomDisplay(createdComputers),
                sourceType: parsed.sourceType,
                sheetName: parsed.sheetName,
            }
        });
    } catch (error) {
        console.error('Error importing computers CSV:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, error: statusCode === 500 ? 'Failed to import computers file' : error.message });
    }
};

module.exports = {
    getComputers,
    createComputer,
    updateComputer,
    deleteComputer,
    importComputersCsv
};
