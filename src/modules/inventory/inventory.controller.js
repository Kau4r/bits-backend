const prisma = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');
const AuditLogger = require('../../utils/auditLogger');
const {
  getRowValue,
  normalizeImportedStatus,
  parseCsvBuffer,
  parseImportedBoolean,
} = require('../../utils/csvImport');
const { readXlsxWorkbook } = require('../../utils/xlsxReader');
const {
  normalizeItemType,
  normalizeBrand,
  normalizeSerial,
  buildSyntheticSerial,
} = require('../../utils/inventoryNormalize');

const VALID_ITEM_STATUSES = ['AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED', 'DISPOSED'];

const parseRoomId = (value) => {
  if (value === undefined || value === null || value === '') return { value: null };
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return { error: 'Invalid room ID' };
  return { value: parsed };
};

const buildImportedItem = (headers, row, defaultRoomId, userId) => {
  const itemCode = getRowValue(headers, row, [
    'Item_Code',
    'Item Code',
    'Asset Code',
    'Asset_Code',
    'Code',
  ]);
  const rawItemType = getRowValue(headers, row, ['Item_Type', 'Item Type', 'Type', 'Asset Type']);
  const normalizedItemType = normalizeItemType(rawItemType || 'OTHER');
  const status = normalizeImportedStatus(
    getRowValue(headers, row, ['Status', 'Stat', 'State']),
    VALID_ITEM_STATUSES,
    'AVAILABLE'
  );
  const roomIdResult = parseRoomId(getRowValue(headers, row, ['Room_ID', 'Room ID', 'RoomId']) || defaultRoomId);

  if (!itemCode) return { error: 'Missing Item_Code / Asset Code' };
  if (!normalizedItemType) return { error: 'Invalid Item_Type' };
  if (!status) return { error: 'Invalid Status' };
  if (roomIdResult.error) return { error: roomIdResult.error };

  return {
    item: {
      Item_Code: itemCode.trim(),
      Item_Type: normalizedItemType,
      Brand: normalizeBrand(getRowValue(headers, row, ['Brand', 'Model', 'Description'])),
      Serial_Number: normalizeSerial(getRowValue(headers, row, ['Serial_Number', 'Serial Number', 'Serial', 'Asset Serial'])),
      Status: status,
      Room_ID: roomIdResult.value,
      IsBorrowable: parseImportedBoolean(getRowValue(headers, row, ['IsBorrowable', 'Borrowable', 'Can Borrow']), false),
      User_ID: userId,
      Created_At: new Date(),
      Updated_At: new Date(),
    }
  };
};

// Get all items
const getItems = async (req, res) => {
  const { roomId, status } = req.query;

  const where = {};
  if (roomId) {
    where.Room_ID = parseInt(roomId);
  }
  if (status) {
    where.Status = status;
  }

  const items = await prisma.item.findMany({
    where,
    include: {
      User: true,
      ReplacedBy: true,
      Replaces: true,
      Borrow_Item: true,
      Tickets: true,
      Room: true,
      Computer: { select: { Computer_ID: true, Name: true, Room_ID: true } }
    },
    orderBy: { Created_At: 'desc' }
  });
  // Frontend expects the join under `Computers`; expose it there.
  const data = items.map(({ Computer, ...rest }) => ({ ...rest, Computers: Computer }));
  res.json({ success: true, data });
};

// Get available items by type (for computer assembly)
const getAvailableItems = async (req, res) => {
  const { type, status, computerId } = req.query;

  // When computerId is supplied, treat items already attached to that
  // computer as "available" — otherwise removing a component row in the
  // edit dialog (without saving) hides the item from the re-add picker
  // because it's still linked in the DB.
  const parsedComputerId = computerId !== undefined && computerId !== ''
    ? parseInt(computerId, 10)
    : null;
  const computerFilter = parsedComputerId !== null && !Number.isNaN(parsedComputerId)
    ? { none: { Computer_ID: { not: parsedComputerId } } }
    : { none: {} };

  const where = {
    Status: status || 'AVAILABLE',
    Computer: computerFilter,
  };

  if (type) {
    const normalizedType = normalizeItemType(type);
    where.Item_Type = normalizedType === 'MINI_PC'
      ? { in: ['MINI_PC', 'SYSTEM_UNIT'] }
      : normalizedType;
  }

  const items = await prisma.item.findMany({
    where,
    select: {
      Item_ID: true,
      Item_Code: true,
      Item_Type: true,
      Brand: true,
      Serial_Number: true,
      Status: true,
    },
    orderBy: { Created_At: 'desc' }
  });

  res.json({ success: true, data: items });
};

// Get item by code
const getItemByCode = async (req, res) => {
  const { itemCode } = req.params;
  const item = await prisma.item.findUnique({
    where: { Item_Code: itemCode },
    include: { Room: true },
  });

  if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

  res.json({ success: true, data: item });
};

// Get item by ID
const getItemById = async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  if (Number.isNaN(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid ID' });
  }
  const item = await prisma.item.findUnique({
    where: { Item_ID: itemId },
    include: {
      User: {
        select: {
          User_ID: true,
          First_Name: true,
          Last_Name: true,
          Email: true
        }
      },
      Room: true,
      ReplacedBy: true,
      Replaces: true,
      Borrow_Item: true,
      Booking: true,
    }
  });
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }
  res.json({ success: true, data: item });
};

// Create new item
const createItem = async (req, res) => {
  const {
    Item_Code,
    Item_Type = 'OTHER',
    Brand,
    Serial_Number,
    Status = 'AVAILABLE',
    Room_ID
  } = req.body;

  // Always use the authenticated user — never trust User_ID from the request body
  const creatorId = req.user.User_ID;

  // Validate required fields
  if (!Item_Code) {
    return res.status(400).json({ success: false, error: 'Item_Code is required' });
  }

  // Check if item code is unique
  const existingItem = await prisma.item.findFirst({
    where: { Item_Code }
  });

  if (existingItem) {
    return res.status(400).json({ success: false, error: 'Item with this code already exists' });
  }

  const normalizedItemType = normalizeItemType(Item_Type);
  if (!normalizedItemType) {
    return res.status(400).json({ success: false, error: 'Invalid Item_Type. Use letters, numbers, spaces, hyphens, or underscores only.' });
  }

  if (Status && !VALID_ITEM_STATUSES.includes(Status)) {
    return res.status(400).json({ success: false, error: `Invalid status: ${Status}` });
  }

  // Create the item
  const currentTime = new Date();
  const itemData = {
    User: { connect: { User_ID: parseInt(creatorId) } },
    Item_Code,
    Item_Type: normalizedItemType,
    Brand: normalizeBrand(Brand),
    Serial_Number: normalizeSerial(Serial_Number),
    Status,
    Created_At: currentTime,
    Updated_At: currentTime
  };

  // Add Room relation if provided
  if (Room_ID) {
    const parsedRoomId = parseInt(Room_ID, 10);
    if (Number.isNaN(parsedRoomId) || parsedRoomId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }
    const room = await prisma.room.findUnique({
      where: { Room_ID: parsedRoomId }
    });

    if (!room) {
      return res.status(400).json({ success: false, error: 'Room not found' });
    }

    itemData.Room = { connect: { Room_ID: parsedRoomId } };
  }

  const item = await prisma.item.create({
    data: itemData
  });

  // Audit Log
  await AuditLogger.log({
    userId: req.user.User_ID,
    action: 'ITEM_CREATED',
    details: `Created item ${Item_Code} (${normalizedItemType})`,
    logType: 'INVENTORY'
  });

  res.status(201).json({ success: true, data: item });
};

// Update item
const updateItem = async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  if (Number.isNaN(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid ID' });
  }
  const {
    Item_Type,
    Brand,
    Serial_Number,
    Status,
    Room_ID,
    IsBorrowable,
  } = req.body;

  const updateData = {};

  if (Item_Type !== undefined) {
    const normalizedItemType = normalizeItemType(Item_Type);
    if (!normalizedItemType) {
      return res.status(400).json({ success: false, error: 'Invalid Item_Type. Use letters, numbers, spaces, hyphens, or underscores only.' });
    }
    updateData.Item_Type = normalizedItemType;
  }

  if (Brand !== undefined) updateData.Brand = normalizeBrand(Brand);
  if (Serial_Number !== undefined) updateData.Serial_Number = normalizeSerial(Serial_Number);
  if (Status !== undefined) {
    if (!VALID_ITEM_STATUSES.includes(Status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    updateData.Status = Status;
  }
  if (IsBorrowable !== undefined) updateData.IsBorrowable = Boolean(IsBorrowable);
  if (Room_ID !== undefined) {
    const parsedRoomId = Room_ID ? parseInt(Room_ID) : null;
    if (Room_ID && Number.isNaN(parsedRoomId)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }
    if (parsedRoomId) {
      const room = await prisma.room.findUnique({ where: { Room_ID: parsedRoomId } });
      if (!room) return res.status(400).json({ success: false, error: 'Room not found' });
    }
    updateData.Room_ID = parsedRoomId;
  }

  // Check if item exists
  const existingItem = await prisma.item.findUnique({
    where: { Item_ID: itemId }
  });

  if (!existingItem) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  // Update the item
  const updatedItem = await prisma.item.update({
    where: { Item_ID: itemId },
    data: updateData
  });

  // Audit Log
  await AuditLogger.log({
    userId: req.user.User_ID,
    action: 'ITEM_UPDATED',
    details: `Updated item ${existingItem.Item_Code}`,
    logType: 'INVENTORY',
    notificationData: { updates: updateData }
  });

  res.json({ success: true, data: updatedItem });
};

// Delete item (soft delete)
const deleteItem = async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  if (Number.isNaN(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid ID' });
  }

  // Check if item exists
  const existingItem = await prisma.item.findUnique({
    where: { Item_ID: itemId }
  });

  if (!existingItem) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  // Soft delete by updating status
  const deletedItem = await prisma.item.update({
    where: { Item_ID: itemId },
    data: {
      Status: 'DISPOSED',
      Updated_At: new Date()
    }
  });

  // Audit Log
  await AuditLogger.log({
    userId: req.user.User_ID,
    action: 'ITEM_DELETED',
    details: `Soft deleted item ${existingItem.Item_Code}`,
    logType: 'INVENTORY'
  });

  res.json({ success: true, data: deletedItem });
};

// Bulk create inventory items
const bulkCreateItems = async (req, res) => {
  const { items } = req.body;

  // Validate input
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Expected an array of items in the request body' });
  }

  const currentYear = new Date().getFullYear();
  const prefix = 'ITM';

  const invalidItem = items.find(item => !normalizeItemType(item.Item_Type || 'OTHER'));
  if (invalidItem) {
    return res.status(400).json({ success: false, error: 'Invalid Item_Type. Use letters, numbers, spaces, hyphens, or underscores only.' });
  }

  const invalidStatusItem = items.find(item => item.Status && !VALID_ITEM_STATUSES.includes(item.Status));
  if (invalidStatusItem) {
    return res.status(400).json({ success: false, error: `Invalid status: ${invalidStatusItem.Status}` });
  }

  const serialNumbers = items.map(item => item.Serial_Number).filter(Boolean);

  // Check for duplicate serial numbers in the current batch
  const duplicateSerials = serialNumbers.filter((num, index) => serialNumbers.indexOf(num) !== index);
  if (duplicateSerials.length > 0) {
    return res.status(400).json({ success: false, error: 'Duplicate serial numbers found in request' });
  }

  const createdItems = await prisma.$transaction(async (tx) => {
    // Validate serial number uniqueness inside the transaction
    if (serialNumbers.length > 0) {
      const existingItems = await tx.item.findMany({
        where: { Serial_Number: { in: serialNumbers } },
        select: { Serial_Number: true }
      });
      if (existingItems.length > 0) {
        throw new AppError('Some serial numbers already exist in the system', 400);
      }
    }

    // Validate Room FK inside the transaction
    const roomIds = [...new Set(items.map(item => item.Room_ID).filter(Boolean).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id) && id > 0))];
    if (roomIds.length > 0) {
      const foundRooms = await tx.room.findMany({
        where: { Room_ID: { in: roomIds } },
        select: { Room_ID: true }
      });
      if (foundRooms.length !== roomIds.length) {
        const foundIds = new Set(foundRooms.map(r => r.Room_ID));
        const missing = roomIds.filter(id => !foundIds.has(id));
        throw new AppError(`Unknown Room_ID(s): ${missing.join(', ')}`, 400);
      }
    }

    // Read latest item code per type inside the transaction
    const itemTypes = [...new Set(items.map(item => normalizeItemType(item.Item_Type || 'OTHER')))];
    const typeCounts = {};
    for (const itemType of itemTypes) {
      const typePrefix = itemType ? itemType.substring(0, 3).toUpperCase() : prefix;
      const latestItem = await tx.item.findFirst({
        where: { Item_Code: { startsWith: `${typePrefix}-${currentYear}-` } },
        orderBy: { Item_Code: 'desc' },
        select: { Item_Code: true }
      });
      typeCounts[itemType] = 0;
      if (latestItem) {
        const lastNumber = parseInt(latestItem.Item_Code.split('-').pop());
        if (!isNaN(lastNumber)) {
          typeCounts[itemType] = lastNumber;
        }
      }
    }

    // Generate codes and create items
    const currentBatchCounts = {};
    const created = [];
    for (const item of items) {
      const itemType = normalizeItemType(item.Item_Type || 'OTHER');
      const typePrefix = itemType ? itemType.substring(0, 3).toUpperCase() : prefix;

      if (currentBatchCounts[itemType] === undefined) {
        currentBatchCounts[itemType] = typeCounts[itemType] || 0;
      }
      currentBatchCounts[itemType]++;
      const itemCode = `${typePrefix}-${currentYear}-${currentBatchCounts[itemType].toString().padStart(3, '0')}`;

      const created_item = await tx.item.create({
        data: {
          Item_Code: itemCode,
          Item_Type: itemType,
          Brand: normalizeBrand(item.Brand),
          Serial_Number: item.Serial_Number || null,
          Status: item.Status || 'AVAILABLE',
          Room_ID: item.Room_ID ? parseInt(item.Room_ID, 10) : null,
          Created_At: new Date(),
          Updated_At: new Date(),
          User_ID: req.user.User_ID
        }
      });
      created.push(created_item);
    }
    return created;
  });

  // Audit Log
  await AuditLogger.log({
    userId: req.user.User_ID,
    action: 'ITEM_CREATED',
    details: `Bulk created ${createdItems.length} items`,
    logType: 'INVENTORY'
  });

  res.status(201).json({
    success: true,
    data: {
      message: `Successfully created ${createdItems.length} items`,
      count: createdItems.length,
      items: createdItems
    }
  });
};

// POST /api/inventory/:id/check - Mark an item as audited (present) for the current semester
const checkInventoryItem = async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (Number.isNaN(itemId)) {
        return res.status(400).json({ success: false, error: 'Invalid item id' });
    }

    const item = await prisma.item.findUnique({ where: { Item_ID: itemId } });
    if (!item) {
        return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const updated = await prisma.item.update({
        where: { Item_ID: itemId },
        data: {
            Last_Checked_At: new Date(),
            Last_Checked_By_ID: req.user.User_ID,
        },
        include: {
            Room: true,
            Last_Checked_By: {
                select: { User_ID: true, First_Name: true, Last_Name: true },
            },
        },
    });

    res.json({ success: true, data: updated });
};

// DELETE /api/inventory/:id/check - Clear an item's audit check
const uncheckInventoryItem = async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (Number.isNaN(itemId)) {
        return res.status(400).json({ success: false, error: 'Invalid item id' });
    }

    const item = await prisma.item.findUnique({ where: { Item_ID: itemId } });
    if (!item) {
        return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const updated = await prisma.item.update({
        where: { Item_ID: itemId },
        data: {
            Last_Checked_At: null,
            Last_Checked_By_ID: null,
        },
        include: {
            Room: true,
            Last_Checked_By: {
                select: { User_ID: true, First_Name: true, Last_Name: true },
            },
        },
    });

    res.json({ success: true, data: updated });
};

const parseInventoryImportFile = (file, sheetName) => {
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
    const isFlatHeaderSheet = headers.some(header =>
      ['Item_Code', 'Item Code', 'Asset Code', 'Item_Type', 'Item Type', 'Room_ID', 'Room ID'].includes(String(header || '').trim())
    );

    if (!isFlatHeaderSheet) {
      const error = new Error('Sheet must have a header row containing Item_Code / Asset Code / Item_Type / Room_ID columns.');
      error.statusCode = 400;
      throw error;
    }

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

// Import inventory items from a flat CSV or XLSX header layout
const importInventoryCsv = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'CSV or Excel file is required' });
    }

    const parsedRoom = parseRoomId(req.body.roomId ?? req.query.roomId);
    if (parsedRoom.error) return res.status(400).json({ success: false, error: parsedRoom.error });

    if (parsedRoom.value) {
      const room = await prisma.room.findUnique({ where: { Room_ID: parsedRoom.value } });
      if (!room) return res.status(400).json({ success: false, error: 'Room not found' });
    }

    const parsed = parseInventoryImportFile(req.file, req.body.sheetName ?? req.query.sheetName);

    const candidateRows = parsed.rows.map(row => {
      const imported = buildImportedItem(parsed.headers, row, parsedRoom.value, req.user.User_ID);
      return {
        rowNumber: row.rowNumber,
        item: imported.item,
        status: imported.error ? 'invalid' : 'valid',
        reason: imported.error || 'Ready to import',
      };
    });

    if (candidateRows.length === 0) {
      return res.status(400).json({ success: false, error: 'Import file must include at least one readable inventory row' });
    }

    const validCandidates = candidateRows.filter(row => row.status === 'valid');
    const seenCodes = new Set();
    for (const row of validCandidates) {
      const key = row.item.Item_Code.toLowerCase();
      if (seenCodes.has(key)) {
        row.status = 'duplicate';
        row.reason = 'Duplicate Item_Code in import file';
      }
      seenCodes.add(key);
    }

    const codes = validCandidates
      .filter(row => row.status === 'valid')
      .map(row => row.item.Item_Code);

    if (codes.length > 0) {
      const existingItems = await prisma.item.findMany({
        where: { Item_Code: { in: codes } },
        select: { Item_Code: true },
      });
      const existingCodes = new Set(existingItems.map(item => item.Item_Code.toLowerCase()));
      validCandidates.forEach(row => {
        if (row.status === 'valid' && existingCodes.has(row.item.Item_Code.toLowerCase())) {
          row.status = 'skipped';
          row.reason = 'Item_Code already exists';
        }
      });
    }

    const rowsToCreate = validCandidates.filter(row => row.status === 'valid');

    // Auto-assign INT-{TYPE}-NNNN synthetic serials for items imported without
    // a real serial. Group missing-serial rows by type, look up the highest
    // existing sequence per type, then number forward.
    const missingByType = new Map();
    for (const row of rowsToCreate) {
      if (!row.item.Serial_Number) {
        const list = missingByType.get(row.item.Item_Type) || [];
        list.push(row);
        missingByType.set(row.item.Item_Type, list);
      }
    }

    for (const [itemType, rows] of missingByType) {
      const prefix = `INT-${itemType}-`;
      const existing = await prisma.item.findMany({
        where: { Item_Type: itemType, Serial_Number: { startsWith: prefix } },
        select: { Serial_Number: true },
      });
      const maxSeq = existing.reduce((max, item) => {
        const match = item.Serial_Number?.match(/(\d+)$/);
        const n = match ? parseInt(match[1], 10) : 0;
        return n > max ? n : max;
      }, 0);
      rows.forEach((row, idx) => {
        row.item.Serial_Number = buildSyntheticSerial(itemType, maxSeq + idx + 1);
      });
    }

    const createdItems = rowsToCreate.length > 0
      ? await prisma.$transaction(rowsToCreate.map(row => prisma.item.create({ data: row.item })))
      : [];

    const createdByCode = new Map(createdItems.map(item => [item.Item_Code.toLowerCase(), item]));
    candidateRows.forEach(row => {
      if (row.status === 'valid') {
        row.status = 'imported';
        row.reason = 'Imported';
        row.itemId = createdByCode.get(row.item.Item_Code.toLowerCase())?.Item_ID;
      }
      if (row.item) {
        row.itemCode = row.item.Item_Code;
        row.itemType = row.item.Item_Type;
        delete row.item;
      }
    });

    if (createdItems.length > 0) {
      await AuditLogger.log({
        userId: req.user.User_ID,
        action: 'ITEM_CREATED',
        details: `Imported ${createdItems.length} inventory item(s) from ${parsed.sourceType === 'xlsx' ? 'Excel' : 'CSV'}`,
        logType: 'INVENTORY'
      });
    }

    const summary = {
      totalRows: candidateRows.length,
      imported: candidateRows.filter(row => row.status === 'imported').length,
      skipped: candidateRows.filter(row => row.status === 'skipped').length,
      invalid: candidateRows.filter(row => row.status === 'invalid').length,
      duplicates: candidateRows.filter(row => row.status === 'duplicate').length,
    };

    res.json({ success: true, data: { summary, rows: candidateRows, items: createdItems, sourceType: parsed.sourceType, sheetName: parsed.sheetName } });
  } catch (error) {
    console.error('Error importing inventory file:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.statusCode ? error.message : 'Failed to import inventory file' });
  }
};

// GET /inventory/item-types - Distinct Item_Type values present in the inventory.
// Used by the labtech RoomDetailModal "Add Item Type" picker so the list of
// available component types is data-driven instead of hardcoded.
const getItemTypes = async (_req, res) => {
  const rows = await prisma.item.findMany({
    distinct: ['Item_Type'],
    select: { Item_Type: true },
    orderBy: { Item_Type: 'asc' },
  });

  // Normalize SYSTEM_UNIT to MINI_PC so callers see one canonical type
  // (matches inventory/getAvailableItems which already merges them).
  const normalized = new Set();
  for (const row of rows) {
    const raw = (row.Item_Type || '').trim().toUpperCase();
    if (!raw) continue;
    normalized.add(raw === 'SYSTEM_UNIT' ? 'MINI_PC' : raw);
  }

  res.json({ success: true, data: [...normalized].sort() });
};

module.exports = {
  getItems,
  getAvailableItems,
  getItemTypes,
  getItemByCode,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  bulkCreateItems,
  importInventoryCsv,
  checkInventoryItem,
  uncheckInventoryItem,
};
