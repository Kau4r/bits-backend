const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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
        Computer_Peripherals: true,  // Peripherals
        Borrow_Item: true,  // Borrow history
        Booking: true  // Booking history
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
    const item = await prisma.Item.findUnique({
      where: { Item_ID: parseInt(req.params.id) },
      include: {
        User: true,
        ReplacedBy: true,
        Replaces: true,
        Computer_Peripherals: true,
        Borrow_Item: true,
        Booking: true
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
      Name,
      Type,
      Brand,
      Model,
      Serial_Number,
      Item_QR_Code,
      Status = 'AVAILABLE',
      Replaced_By_Item_ID = null,
      Notes = ''
    } = req.body;

    // Validate required fields
    if (!User_ID || !Item_Code || !Name || !Type) {
      return res.status(400).json({
        error: 'User_ID, Item_Code, Name, and Type are required'
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

    // Create the item
    const currentTime = new Date();
    const itemData = {
      User: { connect: { User_ID: parseInt(User_ID) } },
      Item_Code,
      Name,
      Type,
      Brand: Brand || '',
      Model: Model || '',
      Serial_Number: Serial_Number || '',
      Item_QR_Code: Item_QR_Code || '',
      Status,
      Created_At: currentTime,
      Updated_At: currentTime
    };

    // Handle the Replaced_By_Item_ID relation if provided
    if (Replaced_By_Item_ID) {
      itemData.Item = {
        connect: { Item_ID: parseInt(Replaced_By_Item_ID) }
      };
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

module.exports = router;
