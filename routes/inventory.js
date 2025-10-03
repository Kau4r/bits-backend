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
        Room: true,
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

// Get item by ID
router.get('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10); // convert string to number
    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await prisma.User.findUnique({
      where: {
        User_ID: userId, // ✅ pass the actual number
      },
      include: {
        Item: true,
        Borrow_Item: true,
        Borrowing_Comp: true,
        Form_Form_Approver_IDToUser: true,
        Form_Form_Creator_IDToUser: true,
        Ticket: true
      }
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ===== Helper: Generate Item Code =====
async function generateItemCode(itemType) {
  const prefix = itemType.substring(0, 3).toUpperCase(); // e.g., MON for Monitor
  const lastItem = await prisma.item.findFirst({
    where: { Item_Type: itemType },
    orderBy: { Item_ID: 'desc' },
    select: { Item_Code: true }
  });

  let nextNumber = 1;
  if (lastItem && lastItem.Item_Code) {
    const match = lastItem.Item_Code.match(/\d+$/);
    if (match) {
      nextNumber = parseInt(match[0], 10) + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

// ===== POST: Create Item(s) =====
router.post("/", async (req, res) => {
  try {
    const { items, User_ID } = req.body;
    if (!User_ID) return res.status(400).json({ error: "User_ID is required" });
    const user = await prisma.user.findUnique({ where: { User_ID: parseInt(User_ID) } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const itemArray = Array.isArray(items) ? items : [items];

    // Keep track of last number per item type
    const lastNumbers = {};

    const createdItems = [];
    for (const item of itemArray) {
      const type = item.Item_Type || "GENERAL";

      // Fetch last item number for this type only once
      if (!(type in lastNumbers)) {
        const lastItem = await prisma.item.findFirst({
          where: { Item_Type: type },
          orderBy: { Item_ID: "desc" },
          select: { Item_Code: true }
        });
        let nextNumber = 1;
        if (lastItem?.Item_Code) {
          const match = lastItem.Item_Code.match(/\d+$/);
          if (match) nextNumber = parseInt(match[0], 10) + 1;
        }
        lastNumbers[type] = nextNumber;
      }

      // Generate unique code in memory
      const code = `${type.substring(0, 3).toUpperCase()}${String(lastNumbers[type]).padStart(3, "0")}`;
      lastNumbers[type]++;

      const itemData = {
        Item_Code: code,
        Item_Type: type,
        Brand: item.Brand || null,
        Serial_Number: item.Serial_Number || null,
        Status: item.Status || "AVAILABLE",
        IsBorrowable: item.IsBorrowable ?? true,
        Created_At: new Date(),
        Updated_At: new Date(),
        User: { connect: { User_ID: parseInt(User_ID) } },
      };

      if (item.Room_ID) {
        const room = await prisma.room.findUnique({ where: { Room_ID: parseInt(item.Room_ID) } });
        if (!room) throw new Error(`Room with ID ${item.Room_ID} not found`);
        itemData.Room = { connect: { Room_ID: parseInt(item.Room_ID) } };
      }

      createdItems.push(await prisma.item.create({ data: itemData }));
    }

    res.status(201).json({
      message: 'Items created',
      count: createdItems.length,
      items: createdItems
    });

  } catch (error) {
    console.error('Error creating items:', error);
    res.status(500).json({
      error: 'Failed to create items',
      details: error.meta || error.message
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

    const allowedFields = ["Item_Type", "Brand", "Serial_Number", "Status", "Room_ID", "User_ID"];
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedFields.includes(key))
    );

    const updatedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: {
        ...filteredUpdates,
        Updated_At: new Date(),
      },
      include: {
        Room: true
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


module.exports = router;
