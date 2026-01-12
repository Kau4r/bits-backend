const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { v4: uuidv4 } = require('uuid');

// ===== GET: All Items =====
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
        Computers: {
          include: {
            Room: true
          }
        },
        Tickets: true,
        Room: true
      },
      orderBy: { Created_At: 'desc' }
    });

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch items', details: error.message });
  }
});


// ===== GET: Item by Code =====
router.get('/code/:itemCode', async (req, res) => {
  const { itemCode } = req.params;
  try {
    const item = await prisma.Item.findUnique({
      where: { Item_Code: itemCode },
      include: { Room: true }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ===== GET: Item by ID =====
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
        Computers: true,
        Room: true
      }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch item', details: error.message });
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

    const createdItems = await Promise.all(itemArray.map(async item => {
      const code = await generateItemCode(item.Item_Type || "GENERAL");
      const itemData = {
        Item_Code: code,
        Item_Type: item.Item_Type || "GENERAL",
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
      return prisma.item.create({ data: itemData });
    }));

    res.status(201).json(createdItems);
  } catch (error) {
    console.error("Error creating items:", error);
    res.status(500).json({ error: "Failed to create item(s)", details: error.message });
  }
});


// ===== PUT: Update Item =====
router.put('/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const existingItem = await prisma.Item.findUnique({ where: { Item_ID: itemId } });
    if (!existingItem) return res.status(404).json({ error: 'Item not found' });

    const updatedItem = await prisma.Item.update({
      where: { Item_ID: itemId }, // use parsed number
      data: req.body
    });

    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update item', details: error.message });
  }
});



// ===== DELETE: Soft Delete Item =====
router.delete('/:id', async (req, res) => {
  const { User_ID } = req.body;

  try {
    const itemId = parseInt(req.params.id);
    const existingItem = await prisma.Item.findUnique({ where: { Item_ID: itemId } });
    if (!existingItem) return res.status(404).json({ error: 'Item not found' });

    const deletedItem = await prisma.Item.update({
      where: { Item_ID: itemId },
      data: { Status: 'INACTIVE', Updated_At: new Date() }
    });

    res.json({ message: 'Item marked as inactive', item: deletedItem });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete item', details: error.message });
  }
});

module.exports = router;
