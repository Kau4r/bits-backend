const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { v4: uuidv4 } = require('uuid');

// Helper function to check user role
const checkUserRole = async (userId, allowedRoles) => {
  try {
    console.log('Checking role for user:', userId, 'Allowed roles:', allowedRoles);

    if (!userId) {
      console.log('No user ID provided');
      return { error: 'User ID is required', status: 401 };
    }

    const user = await prisma.User.findUnique({
      where: { User_ID: parseInt(userId) },
      select: {
        User_Type: true,
        Email: true  // For debugging
      }
    });

    console.log('Found user:', user);

    if (!user) {
      console.log('User not found');
      return { error: 'User not found', status: 404 };
    }


    if (!allowedRoles.includes(user.User_Type)) {
      console.log('User role not allowed. User role:', user.User_Type, 'Allowed roles:', allowedRoles);
      return {
        error: 'Access denied',
        message: `User role ${user.User_Type} is not authorized. Required roles: ${allowedRoles.join(', ')}`,
        status: 403
      };
    }

    console.log('User authorized');
    return { authorized: true };
  } catch (error) {
    console.error('Role check error:', error);
    return {
      error: 'Failed to verify user role',
      details: error.message,
      status: 500
    };
  }
};

// Get all items
router.get('/', async (req, res) => {
  try {
    const items = await prisma.Item.findMany({
      include: {
        User: true,
        ReplacedBy: true,  // Replaced items (self-relation)
        Replaces: true,  // Items that this item replaces
        Borrow_Item: true,  // Borrow history
        Booking: true,  // Booking history
        Computers: true  // Computers this item is part of
      }
    });
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      error: 'Failed to fetch items',
      details: error.message
    });
  }
})

// GET /inventory/code/:itemCode
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
        User: true,
        ReplacedBy: true,
        Replaces: true,
        Borrow_Item: true,
        Booking: true,
        Computers: true
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
router.post('/', async (req, res) => {
  try {
    const {
      User_ID,
      Item_Code,
      Item_Type = 'GENERAL',
      Brand,
      Serial_Number,
      Status = 'AVAILABLE',
      Room_ID
    } = req.body;

    // Validate required fields
    if (!User_ID || !Item_Code) {
      return res.status(400).json({
        error: 'User_ID and Item_Code are required'
      });
    }
    if (!Item_Code) {
      return res.status(400).json({
        error: 'Item_Code is required'
      });
    }
    // Check if user exists
    const user = await prisma.User.findUnique({
      where: { User_ID: parseInt(User_ID) }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if item code is unique
    const existingItem = await prisma.Item.findFirst({
      where: { Item_Code }
    });

    if (existingItem) {
      return res.status(400).json({ error: 'Item with this code already exists' });
    }

    // Validate Item_Type against available enums
    const validItemTypes = ['GENERAL', 'KEYBOARD', 'MOUSE', 'MONITOR', 'SYSTEM_UNIT'];
    if (!validItemTypes.includes(Item_Type)) {
      return res.status(400).json({
        error: `Invalid Item_Type. Must be one of: ${validItemTypes.join(', ')}`
      });
    }

    // Create the item
    const currentTime = new Date();
    const itemData = {
      User: { connect: { User_ID: parseInt(User_ID) } },
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
      // Verify room exists
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
router.put('/:id', async (req, res) => {
  try {
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

    res.json(updatedItem);
  } catch (error) {
    console.error(`Error updating item ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to update item',
      details: error.message
    });
  }
});

// Delete item (soft delete)
router.delete('/:id', async (req, res) => {
  const { User_ID } = req.body;
  const roleCheck = await checkUserRole(User_ID, ['ADMIN', 'LAB_HEAD']);
  if (roleCheck.error) {
    return res.status(roleCheck.status).json({ error: roleCheck.error, message: roleCheck.message });
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

    res.json({ message: 'Item marked as inactive', item: deletedItem });
  } catch (error) {
    console.error(`Error deleting item ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to delete item',
      details: error.message
    });
  }
});

// Bulk create inventory items
router.post('/bulk', async (req, res) => {
  try {
    const { items, User_ID } = req.body;

    const roleCheck = await checkUserRole(User_ID, ['ADMIN', 'LAB_HEAD']);
    if (roleCheck.error) {
      return res.status(roleCheck.status).json({
        error: roleCheck.error,
        message: roleCheck.message
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'Expected an array of items in the request body'
      });
    }

    const currentYear = new Date().getFullYear();
    const prefix = 'ITM'; // Default prefix if no item type

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
        User_ID: parseInt(User_ID)
      };
    });

    // Use transaction to create all items
    const createdItems = await prisma.$transaction(
      itemData.map(item =>
        prisma.Item.create({ data: item })
      )
    );

    res.status(201).json({
      message: `Successfully created ${createdItems.length} items`,
      count: createdItems.length,
      items: createdItems.map(i => ({
        Item_ID: i.Item_ID,
        Item_Name: i.Item_Name,
        Barcode_Number: i.Barcode_Number,
        Status: i.Status
      }))
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