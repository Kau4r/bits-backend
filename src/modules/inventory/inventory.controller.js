const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');
const {
  getRowValue,
  normalizeImportedStatus,
  parseCsvBuffer,
  parseImportedBoolean,
} = require('../../utils/csvImport');
const { readXlsxWorkbook } = require('../../utils/xlsxReader');

const VALID_ITEM_STATUSES = ['AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED', 'DISPOSED'];

const normalizeItemType = (value = 'OTHER') => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  if (['GENERAL', '_', '__'].includes(normalized)) {
    return 'OTHER';
  }
  if (normalized === 'SYSTEM_UNIT') {
    return 'MINI_PC';
  }
  if (!normalized || normalized.length > 50 || !/^[A-Z0-9_]+$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const normalizeBrand = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
};

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
      Serial_Number: getRowValue(headers, row, ['Serial_Number', 'Serial Number', 'Serial', 'Asset Serial']) || null,
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
  try {
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
        Room: true
      },
      orderBy: { Created_At: 'desc' }
    });
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
};

// Get available items by type (for computer assembly)
const getAvailableItems = async (req, res) => {
  try {
    const { type, status } = req.query;

    const where = {
      Status: status || 'AVAILABLE',
      Computer: {
        none: {} // Not assigned to any computer
      }
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
  } catch (error) {
    console.error('Error fetching available items:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch available items' });
  }
};

// Get item by code
const getItemByCode = async (req, res) => {
  const { itemCode } = req.params;
  try {
    const item = await prisma.item.findUnique({
      where: { Item_Code: itemCode },
      include: { Room: true },
    });

    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    res.json({ success: true, data: item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// Get item by ID
const getItemById = async (req, res) => {
  try {
    const item = await prisma.item.findUnique({
      where: { Item_ID: parseInt(req.params.id) },
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
        Room: true
      }
    })
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' })
    }
    res.json({ success: true, data: item })
  } catch (error) {
    console.error(`Error fetching item ${req.params.id}:`, error)
    res.status(500).json({ success: false, error: 'Failed to fetch item' })
  }
};

// Create new item
const createItem = async (req, res) => {
  try {

    const {
      User_ID, // Optional if we use req.user.User_ID
      Item_Code,
      Item_Type = 'OTHER',
      Brand,
      Serial_Number,
      Status = 'AVAILABLE',
      Room_ID
    } = req.body;

    // Use logged in user if User_ID not provided, or override if needed?
    // Assuming we use the creating user as the 'Owner' or 'Creator'
    const creatorId = User_ID || req.user.User_ID;

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

    // Create the item
    const currentTime = new Date();
    const itemData = {
      User: { connect: { User_ID: parseInt(creatorId) } },
      Item_Code,
      Item_Type: normalizedItemType,
      Brand: normalizeBrand(Brand),
      Serial_Number: Serial_Number || null,
      Status,
      Created_At: currentTime,
      Updated_At: currentTime
    };

    // Add Room relation if provided
    if (Room_ID) {
      const room = await prisma.Room.findUnique({
        where: { Room_ID: parseInt(Room_ID) }
      });

      if (!room) {
        return res.status(400).json({ success: false, error: 'Room not found' });
      }

      itemData.Room = { connect: { Room_ID: parseInt(Room_ID) } };
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
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ success: false, error: 'Failed to create item' });
  }
};

// Update item
const updateItem = async (req, res) => {
  try {

    const itemId = parseInt(req.params.id);
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
    if (Serial_Number !== undefined) updateData.Serial_Number = Serial_Number || null;
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
  } catch (error) {
    console.error(`Error updating item ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to update item' });
  }
};

// Delete item (soft delete)
const deleteItem = async (req, res) => {

  try {
    const itemId = parseInt(req.params.id);

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
  } catch (error) {
    console.error(`Error deleting item ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to delete item' });
  }
};

// Bulk create inventory items
const bulkCreateItems = async (req, res) => {
  try {
    const { items, User_ID } = req.body;

    // Validating input
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected an array of items in the request body' });
    }

    const currentYear = new Date().getFullYear();
    const prefix = 'ITM';

    // First, get all unique item types and serial numbers in this batch
    const invalidItem = items.find(item => !normalizeItemType(item.Item_Type || 'OTHER'));
    if (invalidItem) {
      return res.status(400).json({ success: false, error: 'Invalid Item_Type. Use letters, numbers, spaces, hyphens, or underscores only.' });
    }

    const itemTypes = [...new Set(items.map(item => normalizeItemType(item.Item_Type || 'OTHER')))];
    const serialNumbers = items.map(item => item.Serial_Number).filter(Boolean);

    // Check for duplicate serial numbers in the current batch
    const duplicateSerials = serialNumbers.filter((num, index) => serialNumbers.indexOf(num) !== index);
    if (duplicateSerials.length > 0) {
      return res.status(400).json({ success: false, error: 'Duplicate serial numbers found in request' });
    }

    // Check if any serial numbers already exist in the database
    if (serialNumbers.length > 0) {
      const existingItems = await prisma.item.findMany({
        where: {
          Serial_Number: {
            in: serialNumbers
          }
        },
        select: {
          Serial_Number: true
        }
      });

      if (existingItems.length > 0) {
        return res.status(400).json({ success: false, error: 'Some serial numbers already exist in the system' });
      }
    }

    // Get the highest number for each item type
    const typeCounts = {};

    // Find the highest number for each item type in the database
    for (const itemType of itemTypes) {
      const typePrefix = itemType ? itemType.substring(0, 3).toUpperCase() : prefix;

      const latestItem = await prisma.item.findFirst({
        where: {
          Item_Code: {
            startsWith: `${typePrefix}-${currentYear}-`
          }
        },
        orderBy: {
          Item_Code: 'desc'
        },
        select: {
          Item_Code: true
        }
      });

      // Initialize counter for this item type
      typeCounts[itemType] = 0;
      if (latestItem) {
        const lastCode = latestItem.Item_Code;
        const lastNumber = parseInt(lastCode.split('-').pop());
        if (!isNaN(lastNumber)) {
          typeCounts[itemType] = lastNumber;
        }
      }
    }

    // Track counts for the current batch
    const currentBatchCounts = {};

    // Prepare item data with generated codes
    const itemData = items.map(item => {
      const itemType = normalizeItemType(item.Item_Type || 'OTHER');
      const typePrefix = itemType ? itemType.substring(0, 3).toUpperCase() : prefix;

      // Initialize counter for this item type if not exists
      if (currentBatchCounts[itemType] === undefined) {
        currentBatchCounts[itemType] = typeCounts[itemType] || 0;
      }

      // Increment counter for this item type
      currentBatchCounts[itemType]++;
      const itemNumber = currentBatchCounts[itemType].toString().padStart(3, '0');
      const itemCode = `${typePrefix}-${currentYear}-${itemNumber}`;

      return {
        Item_Code: itemCode,
        Item_Type: itemType,
        Brand: normalizeBrand(item.Brand),
        Serial_Number: item.Serial_Number || null,
        Status: item.Status || 'AVAILABLE',
        Room_ID: item.Room_ID || null,
        Created_At: new Date(),
        Updated_At: new Date(),
        User_ID: parseInt(User_ID || req.user.User_ID)
      };
    });

    // Use transaction to create all items
    const createdItems = await prisma.$transaction(
      itemData.map(item =>
        prisma.item.create({ data: item })
      )
    );

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

  } catch (error) {
    console.error('Error in bulk item creation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create items',
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
    });
  }
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

module.exports = {
  getItems,
  getAvailableItems,
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
