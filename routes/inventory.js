const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../src/middleware/auth');

// Middleware to check user role
const checkRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required' 
      });
    }

    if (roles.length && !roles.includes(req.user.User_Role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions',
        requiredRoles: roles,
        userRole: req.user.User_Role
      });
    }
    next();
  };
};

// Define middleware functions
const requireAuth = (req, res, next) => authenticateToken(req, res, next);
const requireAdmin = [
  (req, res, next) => authenticateToken(req, res, next),
  (req, res, next) => checkRole(['ADMIN', 'LAB_HEAD'])(req, res, next)
];

// Apply middleware to routes
router.get('/', requireAdmin, async (req, res) => {
  try {
    const items = await prisma.Item.findMany({
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
        Computers: true
      }
    });

    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch items',
      details: error.message
    });
  }
});

// GET /inventory/code/:itemCode
router.get('/code/:itemCode', authenticateToken, async (req, res) => {
  const { itemCode } = req.params;

  try {
    const item = await prisma.Item.findUnique({
      where: { Item_Code: itemCode },
      include: { 
        Room: true,
        User: {
          select: {
            User_ID: true,
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        }
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    console.error('Error fetching item by code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch item',
      details: error.message
    });
  }
});

// Get item by ID
router.get('/:id', authenticateToken, async (req, res) => {
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
        Computers: true
      }
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    console.error(`Error fetching item ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch item',
      details: error.message
    });
  }
});

// Create new item
router.post('/', authenticateToken, checkRole(['ADMIN', 'LAB_HEAD']), async (req, res) => {
  try {
    const {
      Item_Type = 'GENERAL',
      Brand,
      Serial_Number,
      Status = 'AVAILABLE',
      Room_ID
    } = req.body;
    
    const currentYear = new Date().getFullYear();
    const itemType = (Item_Type || 'GENERAL').toUpperCase();
    const prefix = itemType.substring(0, 3);
    
    // Check if serial number is provided and unique
    if (Serial_Number) {
      const existingSerial = await prisma.Item.findFirst({
        where: { 
          Serial_Number: Serial_Number 
        },
        select: { Item_ID: true }
      });

      if (existingSerial) {
        return res.status(400).json({
          success: false,
          error: 'Serial number already exists',
          details: 'The provided serial number is already in use by another item'
        });
      }
    }

    // Generate item code
    const latestItem = await prisma.Item.findFirst({
      where: {
        Item_Code: {
          startsWith: `${prefix}-${currentYear}-`
        }
      },
      orderBy: {
        Item_Code: 'desc'
      },
      select: {
        Item_Code: true
      }
    });
    
    // Determine the next number
    let nextNumber = 1;
    if (latestItem) {
      const lastCode = latestItem.Item_Code;
      const lastNumber = parseInt(lastCode.split('-').pop());
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
    
    // Create the item code
    const paddedNumber = nextNumber.toString().padStart(3, '0');
    const Item_Code = `${prefix}-${currentYear}-${paddedNumber}`;

    // Create the item data
    const itemData = {
      Item_Code,
      Item_Type: itemType,
      Brand: Brand || null,
      Serial_Number: Serial_Number || null,
      Status,
      User: { connect: { User_ID: req.user.User_ID } },
      ...(Room_ID ? { Room: { connect: { Room_ID: parseInt(Room_ID) } } } : {}),
      Created_At: new Date(),
      Updated_At: new Date()
    };

    // Create the item
    const newItem = await prisma.Item.create({
      data: itemData,
      include: {
        User: {
          select: {
            User_ID: true,
            First_Name: true,
            Last_Name: true
          }
        },
        Room: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Item created successfully',
      data: newItem
    });
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create item',
      details: error.message
    });
  }
});

// Update item
router.put('/:id', authenticateToken, checkRole(['ADMIN', 'LAB_HEAD']), async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const updates = req.body;

    // Check if item exists
    const existingItem = await prisma.Item.findUnique({
      where: { Item_ID: itemId }
    });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    // Validate Item_Type if provided
    if (updates.Item_Type) {
      const validItemTypes = ['GENERAL', 'KEYBOARD', 'MOUSE', 'MONITOR', 'SYSTEM_UNIT'];
      if (!validItemTypes.includes(updates.Item_Type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid Item_Type. Must be one of: ${validItemTypes.join(', ')}`
        });
      }
    }

    // Update the item
    const updatedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: {
        ...updates,
        Updated_At: new Date()
      },
      include: {
        User: {
          select: {
            User_ID: true,
            First_Name: true,
            Last_Name: true
          }
        },
        Room: true
      }
    });

    res.json({
      success: true,
      message: 'Item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    console.error(`Error updating item ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to update item',
      details: error.message
    });
  }
});

// Delete item (soft delete)
router.delete('/:id', authenticateToken, checkRole(['ADMIN', 'LAB_HEAD']), async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);

    // Check if item exists
    const existingItem = await prisma.Item.findUnique({
      where: { Item_ID: itemId }
    });

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    // Soft delete by updating status
    const deletedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: {
        Status: 'INACTIVE',
        Updated_At: new Date()
      },
      include: {
        User: {
          select: {
            User_ID: true,
            First_Name: true,
            Last_Name: true
          }
        },
        Room: true
      }
    });

    res.json({
      success: true,
      message: 'Item marked as inactive',
      data: deletedItem
    });
  } catch (error) {
    console.error(`Error deleting item ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete item',
      details: error.message
    });
  }
});

// Bulk create inventory items
router.post('/bulk', authenticateToken, checkRole(['ADMIN', 'LAB_HEAD']), async (req, res) => {
  try {
    const { items } = req.body;
    const currentYear = new Date().getFullYear();

    // Validate that all Room_IDs exist if provided
    const roomIds = [...new Set(items
      .map(item => item.Room_ID)
      .filter(Boolean)
    )];
    
    if (roomIds.length > 0) {
      const existingRooms = await prisma.room.findMany({
        where: { Room_ID: { in: roomIds } },
        select: { Room_ID: true }
      });
      
      const existingRoomIds = new Set(existingRooms.map(r => r.Room_ID));
      const missingRooms = roomIds.filter(id => !existingRoomIds.has(id));
      
      if (missingRooms.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'One or more Room_IDs do not exist',
          missingRooms
        });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: 'Expected a non-empty array of items in the request body'
      });
    }

    // Get all unique serial numbers in this batch
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

    // Group items by type and year for incrementing
    const itemGroups = {};

    // First pass: Group items by type and year
    items.forEach(item => {
      const itemType = (item.Item_Type || 'GENERAL').toUpperCase();
      const prefix = itemType.substring(0, 3);
      const year = currentYear;
      const key = `${prefix}-${year}`;
      
      if (!itemGroups[key]) {
        itemGroups[key] = {
          prefix,
          year,
          items: [],
          nextNumber: 1
        };
      }
      
      itemGroups[key].items.push(item);
    });

    // Get the latest numbers for each group from the database
    const groupKeys = Object.keys(itemGroups);
    const existingCounts = await Promise.all(
      groupKeys.map(key => {
        const { prefix, year } = itemGroups[key];
        return prisma.item.findMany({
          where: {
            Item_Code: {
              startsWith: `${prefix}-${year}-`
            }
          },
          select: {
            Item_Code: true
          },
          orderBy: {
            Item_Code: 'desc'
          },
          take: 1
        });
      })
    );

    // Update nextNumber for each group based on existing items
    groupKeys.forEach((key, index) => {
      const latestItem = existingCounts[index][0];
      if (latestItem) {
        const lastNumber = parseInt(latestItem.Item_Code.split('-').pop());
        if (!isNaN(lastNumber)) {
          itemGroups[key].nextNumber = lastNumber + 1;
        }
      }
    });

    // Prepare item data with generated codes
    const itemData = [];
    
    // Process each group and generate codes
    for (const key in itemGroups) {
      const group = itemGroups[key];
      let currentNumber = group.nextNumber;
      
      for (const item of group.items) {
        const paddedNumber = currentNumber.toString().padStart(3, '0');
        const itemCode = `${group.prefix}-${group.year}-${paddedNumber}`;
        currentNumber++;
        const itemType = (item.Item_Type || 'GENERAL').toUpperCase();

        // Add the item with generated code
        itemData.push({
          Item_Code: itemCode,
          Item_Type: itemType,
          Brand: item.Brand || null,
          Serial_Number: item.Serial_Number || null,
          Status: item.Status || 'AVAILABLE',
          ...(item.Room_ID ? { Room_ID: item.Room_ID } : {}),
          Created_At: new Date(),
          Updated_At: new Date(),
          User_ID: req.user.User_ID // Use the authenticated user's ID from the request
        });
      }
    }

    // Use transaction to create all items
    const createdItems = await prisma.$transaction(
      itemData.map(item =>
        prisma.Item.create({ 
          data: item,
          include: {
            User: {
              select: {
                User_ID: true,
                First_Name: true,
                Last_Name: true
              }
            },
            Room: true
          }
        })
      )
    );

    res.status(201).json({
      success: true,
      message: `Successfully created ${createdItems.length} items`,
      data: createdItems
    });
  } catch (error) {
    console.error('Error in bulk item creation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create items',
      details: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

module.exports = router;