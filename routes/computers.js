const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// GET all computers (with optional roomId filter)
router.get('/', async (req, res) => {
  try {
    const { roomId } = req.query;

    const where = {};
    if (roomId) {
      where.Room_ID = parseInt(roomId);
    }

    const computers = await prisma.computer.findMany({
      where,
      include: {
        Room: {
          select: {
            Room_ID: true,
            Name: true,
            Room_Type: true,
          }
        },
        Items: {
          select: {
            Item_ID: true,
            Item_Code: true,
            Item_Type: true,
            Brand: true,
            Serial_Number: true,
            Status: true,
          }
        }
      },
      orderBy: { Name: 'asc' }
    });

    res.json(computers);
  } catch (error) {
    console.error('Error fetching computers:', error);
    res.status(500).json({ error: 'Failed to fetch computers' });
  }
});

// GET single computer by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: parseInt(id) },
      include: {
        Room: {
          select: {
            Room_ID: true,
            Name: true,
            Room_Type: true,
          }
        },
        Items: {
          select: {
            Item_ID: true,
            Item_Code: true,
            Item_Type: true,
            Brand: true,
            Serial_Number: true,
            Status: true,
          }
        }
      }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    res.json(computer);
  } catch (error) {
    console.error('Error fetching computer:', error);
    res.status(500).json({ error: 'Failed to fetch computer' });
  }
});

// POST create new computer with items
router.post('/', async (req, res) => {
  try {
    const { name, roomId, status, items } = req.body;
    // items: [{ itemType, brand, serialNumber }]

    if (!name) {
      return res.status(400).json({ error: 'Computer name is required' });
    }

    // Create computer first
    const computer = await prisma.computer.create({
      data: {
        Name: name,
        Room_ID: roomId ? parseInt(roomId) : null,
        Status: status || 'AVAILABLE',
      }
    });

    // Create items and link to computer
    if (items && items.length > 0) {
      for (const item of items) {
        const itemCode = `${item.itemType}-${computer.Computer_ID}-${Date.now()}`;
        await prisma.item.create({
          data: {
            Item_Code: itemCode,
            Item_Type: item.itemType, // KEYBOARD, MOUSE, MONITOR, SYSTEM_UNIT
            Brand: item.brand || null,
            Serial_Number: item.serialNumber || null,
            Status: 'AVAILABLE',
            IsBorrowable: false,
            Computers: {
              connect: { Computer_ID: computer.Computer_ID }
            }
          }
        });
      }
    }

    // Fetch the complete computer with items
    const result = await prisma.computer.findUnique({
      where: { Computer_ID: computer.Computer_ID },
      include: {
        Room: {
          select: {
            Room_ID: true,
            Name: true,
            Room_Type: true,
          }
        },
        Items: true
      }
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating computer:', error);
    res.status(500).json({ error: 'Failed to create computer' });
  }
});

// PUT update computer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, roomId, status, items } = req.body;

    const computerId = parseInt(id);

    // Update computer
    const updateData = {};
    if (name !== undefined) updateData.Name = name;
    if (roomId !== undefined) updateData.Room_ID = roomId ? parseInt(roomId) : null;
    if (status !== undefined) updateData.Status = status;

    await prisma.computer.update({
      where: { Computer_ID: computerId },
      data: updateData
    });

    // Update items if provided
    if (items && items.length > 0) {
      for (const item of items) {
        if (item.itemId) {
          // Update existing item
          await prisma.item.update({
            where: { Item_ID: item.itemId },
            data: {
              Brand: item.brand,
              Serial_Number: item.serialNumber,
              Status: item.status || 'AVAILABLE',
            }
          });
        } else {
          // Create new item
          const itemCode = `${item.itemType}-${computerId}-${Date.now()}`;
          await prisma.item.create({
            data: {
              Item_Code: itemCode,
              Item_Type: item.itemType,
              Brand: item.brand || null,
              Serial_Number: item.serialNumber || null,
              Status: 'AVAILABLE',
              IsBorrowable: false,
              Computers: {
                connect: { Computer_ID: computerId }
              }
            }
          });
        }
      }
    }

    // Fetch updated computer
    const result = await prisma.computer.findUnique({
      where: { Computer_ID: computerId },
      include: {
        Room: {
          select: {
            Room_ID: true,
            Name: true,
            Room_Type: true,
          }
        },
        Items: true
      }
    });

    res.json(result);
  } catch (error) {
    console.error('Error updating computer:', error);
    res.status(500).json({ error: 'Failed to update computer' });
  }
});

// DELETE computer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const computerId = parseInt(id);

    // First disconnect items from this computer (don't delete items, just unlink)
    await prisma.computer.update({
      where: { Computer_ID: computerId },
      data: {
        Items: {
          set: [] // Disconnect all items
        }
      }
    });

    // Delete computer
    await prisma.computer.delete({
      where: { Computer_ID: computerId }
    });

    res.json({ message: 'Computer deleted successfully' });
  } catch (error) {
    console.error('Error deleting computer:', error);
    res.status(500).json({ error: 'Failed to delete computer' });
  }
});

module.exports = router;
