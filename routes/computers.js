const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create a new computer with items
router.post('/', async (req, res) => {
  try {
    const { name, description, itemIds } = req.body;
    
    const computer = await prisma.$transaction(async (prisma) => {
      const newComputer = await prisma.computer.create({
        data: {
          Name: name,
          Description: description,
          Status: 'AVAILABLE',
          Created_At: new Date(),
          Updated_At: new Date()
        }
      });

      if (itemIds && itemIds.length > 0) {
        await Promise.all(itemIds.map(itemId => 
          prisma.computerItem.create({
            data: {
              Computer_ID: newComputer.Computer_ID,
              Item_ID: itemId,
              Created_At: new Date()
            }
          })
        ));
      }

      return newComputer;
    });

    res.status(201).json(computer);
  } catch (error) {
    console.error('Error creating computer:', error);
    res.status(500).json({ error: 'Failed to create computer', details: error.message });
  }
});

// Get all computers with their items
router.get('/', async (req, res) => {
  try {
    const computers = await prisma.computer.findMany({
      include: {
        Items: {
          include: {
            Item: true
          }
        }
      },
      orderBy: {
        Created_At: 'desc'
      }
    });
    res.json(computers);
  } catch (error) {
    console.error('Error fetching computers:', error);
    res.status(500).json({ error: 'Failed to fetch computers', details: error.message });
  }
});

// Get computer by ID with items
router.get('/:id', async (req, res) => {
  try {
    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: parseInt(req.params.id) },
      include: {
        Items: {
          include: {
            Item: true
          }
        },
        Borrowing_Comp: true
      }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    res.json(computer);
  } catch (error) {
    console.error(`Error fetching computer ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch computer', details: error.message });
  }
});

// Update computer status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'DECOMMISSIONED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const computer = await prisma.computer.update({
      where: { Computer_ID: parseInt(req.params.id) },
      data: {
        Status: status,
        Updated_At: new Date()
      }
    });

    res.json(computer);
  } catch (error) {
    console.error(`Error updating computer ${req.params.id} status:`, error);
    res.status(500).json({ error: 'Failed to update computer status', details: error.message });
  }
});

// Add items to computer
router.post('/:id/items', async (req, res) => {
  try {
    const { itemIds } = req.body;

    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: parseInt(req.params.id) }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    await Promise.all(itemIds.map(itemId => 
      prisma.computerItem.create({
        data: {
          Computer_ID: parseInt(req.params.id),
          Item_ID: itemId,
          Created_At: new Date()
        }
      })
    ));

    res.status(201).json({ message: 'Items added to computer' });
  } catch (error) {
    console.error('Error adding items to computer:', error);
    res.status(500).json({ error: 'Failed to add items to computer', details: error.message });
  }
});

// Remove item from computer
router.delete('/:computerId/items/:itemId', async (req, res) => {
  try {
    await prisma.computerItem.delete({
      where: {
        Computer_ID_Item_ID: {
          Computer_ID: parseInt(req.params.computerId),
          Item_ID: parseInt(req.params.itemId)
        }
      }
    });

    res.json({ message: 'Item removed from computer' });
  } catch (error) {
    console.error('Error removing item from computer:', error);
    res.status(500).json({ error: 'Failed to remove item from computer', details: error.message });
  }
});

module.exports = router;
