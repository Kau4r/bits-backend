const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prisma');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../src/middleware/auth');
const { asyncHandler } = require('../src/middleware/errorHandler');
const AuditLogger = require('../src/utils/auditLogger');

// Helper function to check user role (kept for backward compatibility if needed, but using middleware is better)
const checkUserRole = async (userId, allowedRoles) => {
  // ... (keeping existing logic if reused, but authenticateToken sets req.user)
  // We can use req.user from middleware
  return { authorized: true };
};

// Get all items
router.get('/', async (req, res) => {
  try {
    const { roomId, status } = req.query;

    const where = {};
    if (roomId) {
      where.Room_ID = parseInt(roomId);
    }
    if (status) {
      where.Status = status;
    }

    const items = await prisma.Item.findMany({
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
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      error: 'Failed to fetch items',
      details: error.message
    });
  }
});


// ===== GET: Item by Code =====
router.get('/code/:itemCode', async (req, res) => {
  const { itemCode } = req.params;
  try {
    const item = await prisma.Item.findUnique({
      where: { Item_Code: itemCode },
      include: { Room: true },
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get item by ID
router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.Item.findUnique({
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
      return res.status(404).json({ error: 'Item not found' })
    }
    res.json(item)
  } catch (error) {
    console.error(`Error fetching item ${req.params.id}:`, error)
    res.status(500).json({ error: 'Failed to fetch item', details: error.message })
  }
})

// Create new item
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Check perm
    if (!['ADMIN', 'LAB_HEAD', 'LAB_TECH'].includes(req.user.User_Role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const {
      User_ID, // Optional if we use req.user.User_ID
      Item_Code,
      Item_Type = 'GENERAL',
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
      return res.status(400).json({
        error: 'Item_Code is required'
      });
    }

    // Check if item code is unique
    const existingItem = await prisma.Item.findFirst({
      where: { Item_Code }
    });

    if (existingItem) {
      return res.status(400).json({ error: 'Item with this code already exists' });
    }

    // Validate Item_Type against available enums (must match Prisma schema)
    const validItemTypes = ['HDMI', 'VGA', 'ADAPTER', 'PROJECTOR', 'EXTENSION', 'MOUSE', 'KEYBOARD', 'MONITOR', 'GENERAL', 'OTHER'];
    if (!validItemTypes.includes(Item_Type)) {
      return res.status(400).json({
        error: `Invalid Item_Type. Must be one of: ${validItemTypes.join(', ')}`
      });
    }

    // Create the item
    const currentTime = new Date();
    const itemData = {
      User: { connect: { User_ID: parseInt(creatorId) } },
      Item_Code,
      Item_Type,
      Brand: Brand || null,
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
        return res.status(400).json({ error: 'Room not found' });
      }

      itemData.Room = { connect: { Room_ID: parseInt(Room_ID) } };
    }

    const item = await prisma.Item.create({
      data: itemData
    });

    // Audit Log
    await AuditLogger.log(
      req.user.User_ID,
      'ITEM_CREATED',
      `Created item ${Item_Code} (${Item_Type})`
    );

    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({
      error: 'Failed to create item',
      details: error.message
    });
  }
});


// Update item
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!['ADMIN', 'LAB_HEAD', 'LAB_TECH'].includes(req.user.User_Role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const itemId = parseInt(req.params.id);
    const updates = req.body;

    // Check if item exists
    const existingItem = await prisma.Item.findUnique({
      where: { Item_ID: itemId }
    });

    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Update the item
    const updatedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: {
        ...updates,
        Updated_At: new Date()
      }
    });

    // Audit Log
    await AuditLogger.log({
      userId: req.user.User_ID,
      action: 'ITEM_UPDATED',
      details: `Updated item ${existingItem.Item_Code}`,
      logType: 'INVENTORY',
      notificationData: { updates }
    });

    res.json({
      success: true,
      message: 'Item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    console.error(`Error updating item ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to update item',
      details: error.message
    });
  }
});


// Delete item (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  // Use Middleware for role check
  if (!['ADMIN', 'LAB_HEAD'].includes(req.user.User_Role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const itemId = parseInt(req.params.id);

    // Check if item exists
    const existingItem = await prisma.Item.findUnique({
      where: { Item_ID: itemId }
    });

    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Soft delete by updating status
    const deletedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: {
        Status: 'INACTIVE',
        Updated_At: new Date()
      }
    });

    // Audit Log
    await AuditLogger.log(
      req.user.User_ID,
      'ITEM_DELETED', // Ensure this Action enum exists, if not use ITEM_UPDATED
      `Soft deleted item ${existingItem.Item_Code}`
    );

    res.json({
      success: true,
      message: 'Item marked as inactive',
      data: deletedItem
    });
  } catch (error) {
    console.error(`Error deleting item ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to delete item',
      details: error.message
    });
  }
});

// Bulk create inventory items
router.post('/bulk', authenticateToken, async (req, res) => {
  try {
    if (!['ADMIN', 'LAB_HEAD', 'LAB_TECH'].includes(req.user.User_Role)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { items, User_ID } = req.body;
    // ... bulk logic ...

    // Validating input
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'Expected an array of items in the request body'
      });
    }

    const currentYear = new Date().getFullYear();
    const prefix = 'ITM';

    // First, get all unique item types and serial numbers in this batch
    const itemTypes = [...new Set(items.map(item => item.Item_Type || 'GENERAL'))];
    const serialNumbers = items.map(item => item.Serial_Number).filter(Boolean);

    // Check for duplicate serial numbers in the current batch
    const duplicateSerials = serialNumbers.filter((num, index) => serialNumbers.indexOf(num) !== index);
    if (duplicateSerials.length > 0) {
      return res.status(400).json({
        error: 'Duplicate serial numbers found',
        details: 'The following serial numbers appear more than once in your request',
        duplicateSerials: [...new Set(duplicateSerials)]
      });
    }

    // Check if any serial numbers already exist in the database
    if (serialNumbers.length > 0) {
      const existingItems = await prisma.Item.findMany({
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
        return res.status(400).json({
          error: 'Duplicate serial numbers found',
          details: 'The following serial numbers already exist in the system',
          existingSerials: existingItems.map(i => i.Serial_Number)
        });
      }
    }

    // Get the highest number for each item type
    const typeCounts = {};

    // Find the highest number for each item type in the database
    for (const itemType of itemTypes) {
      const typePrefix = itemType ? itemType.substring(0, 3).toUpperCase() : prefix;

      const latestItem = await prisma.Item.findFirst({
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
      const itemType = item.Item_Type || 'GENERAL';
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
        Brand: item.Brand || null,
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
        prisma.Item.create({ data: item })
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
      message: `Successfully created ${createdItems.length} items`,
      count: createdItems.length,
      items: createdItems // Return full item objects for frontend
    });

  } catch (error) {
    console.error('Error in bulk item creation:', error);
    res.status(500).json({
      error: 'Failed to create items',
      details: error.message,
      ...(error.code && { code: error.code })
    });
  }
});

module.exports = router;
