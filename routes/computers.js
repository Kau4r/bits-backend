const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create a new computer with items
router.post('/', async (req, res) => {
  try {
    const { name, roomId, itemIds } = req.body;

    const computer = await prisma.computer.create({
      data: {
        Name: name,
        Status: 'AVAILABLE',
        Created_At: new Date(),
        Updated_At: new Date(),
        // Connect to room if provided
        ...(roomId && { Room: { connect: { Room_ID: parseInt(roomId) } } }),
        // Connect items if provided
        ...(itemIds && itemIds.length > 0 && {
          Items: { connect: itemIds.map(id => ({ Item_ID: id })) }
        })
      },
      include: {
        Items: true,
        Room: true
      }
    });

    res.status(201).json(computer);
  } catch (error) {
    console.error('Error creating computer:', error);
    res.status(500).json({ error: 'Failed to create computer', details: error.message });
  }
});

// Get all computers with their items and room
router.get('/', async (req, res) => {
  try {
    const computers = await prisma.computer.findMany({
      include: {
        Items: true,
        Room: true
      },
      orderBy: {
        Name: 'asc'
      }
    });
    res.json(computers);
  } catch (error) {
    console.error('Error fetching computers:', error);
    res.status(500).json({ error: 'Failed to fetch computers', details: error.message });
  }
});

// Get computer by ID with items and room
router.get('/:id', async (req, res) => {
  try {
    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: parseInt(req.params.id) },
      include: {
        Items: true,
        Room: true
      }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    res.json(computer);
  } catch (error) {
    console.error('Error fetching computer:', error);
    res.status(500).json({ error: 'Failed to fetch computer', details: error.message });
  }
});

// Delete a computer
router.delete('/:id', async (req, res) => {
  try {
    const { name, roomId, status, items, macAddress } = req.body;
    // items: [{ itemType, brand, serialNumber }]

    if (!name) {
      return res.status(400).json({ error: 'Computer name is required' });
    }

    // Validate MAC address format if provided
    if (macAddress) {
      const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
      if (!macRegex.test(macAddress)) {
        return res.status(400).json({ error: 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX' });
      }
    }

    // Create computer first
    const computer = await prisma.computer.create({
      data: {
        Name: name,
        Mac_Address: macAddress || null,
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

    res.json(computer);
  } catch (error) {
    console.error(`Error updating computer ${req.params.id} status:`, error);
    res.status(500).json({ error: 'Failed to update computer status', details: error.message });
  }
});

// Update computer items and room
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, roomId, status, items, macAddress } = req.body;

    const computerId = parseInt(id);

    // Validate MAC address format if provided
    if (macAddress !== undefined && macAddress !== null) {
      const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
      if (!macRegex.test(macAddress)) {
        return res.status(400).json({ error: 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX' });
      }
    }

    // Update computer
    const updateData = {};
    if (name !== undefined) updateData.Name = name;
    if (roomId !== undefined) updateData.Room_ID = roomId ? parseInt(roomId) : null;
    if (status !== undefined) updateData.Status = status;
    if (macAddress !== undefined) updateData.Mac_Address = macAddress;

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

// GET computer by MAC address
router.get('/by-mac/:macAddress', async (req, res) => {
  try {
    const { macAddress } = req.params;

    // Validate MAC address format
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(macAddress)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    const computer = await prisma.computer.findUnique({
      where: { Mac_Address: macAddress },
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
      return res.status(404).json({ error: 'Computer not found with this MAC address' });
    }

    res.json(computer);
  } catch (error) {
    console.error('Error fetching computer by MAC:', error);
    res.status(500).json({ error: 'Failed to fetch computer' });
  }
});

module.exports = router;
