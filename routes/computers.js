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
    const computerId = parseInt(req.params.id);
    
    // First verify the computer exists
    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: computerId },
      include: { 
        Items: true,
        Room: true
      }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    // First, disconnect all items from the computer
    await prisma.computer.update({
      where: { Computer_ID: computerId },
      data: {
        Items: {
          set: []
        },
        Room: computer.Room ? { disconnect: true } : undefined
      }
    });

    // Then delete the computer
    await prisma.computer.delete({
      where: { Computer_ID: computerId }
    });

    res.status(204).end();
  } catch (error) {
    console.error('Error deleting computer:', error);
    res.status(500).json({ 
      error: 'Failed to delete computer', 
      details: error.message 
    });
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

// Update computer items and room
router.patch('/:id', async (req, res) => {
  try {
    const { itemIds, roomId } = req.body;
    const computerId = parseInt(req.params.id);
    
    // First verify the computer exists
    const computer = await prisma.computer.findUnique({
      where: { Computer_ID: computerId },
      include: { Items: true }
    });

    if (!computer) {
      return res.status(404).json({ error: 'Computer not found' });
    }

    // Prepare update data
    const updateData = {
      Updated_At: new Date()
    };

    // Add items update if provided
    if (itemIds) {
      updateData.Items = {
        set: itemIds.map(id => ({ Item_ID: id }))
      };
    }

    // Add room update if provided
    if (roomId !== undefined) {
      if (roomId === null) {
        // Remove from room
        updateData.Room = { disconnect: true };
      } else {
        // Connect to new room
        updateData.Room = { connect: { Room_ID: roomId } };
      }
    }

    // Update the computer
    const updatedComputer = await prisma.computer.update({
      where: { Computer_ID: computerId },
      data: updateData,
      include: {
        Items: true,
        Room: true
      }
    });

    res.json(updatedComputer);
  } catch (error) {
    console.error('Error updating computer:', error);
    res.status(500).json({ 
      error: 'Failed to update computer', 
      details: error.message 
    });
  }
});

// Remove item from computer
router.delete('/:computerId/items/:itemId', async (req, res) => {
  try {
    const computer = await prisma.computer.update({
      where: { Computer_ID: parseInt(req.params.computerId) },
      data: {
        Items: {
          disconnect: { Item_ID: parseInt(req.params.itemId) }
        }
      },
      include: {
        Items: true
      }
    });
    
    res.json({ 
      message: 'Item removed from computer',
      computer
    });
  } catch (error) {
    console.error('Error removing item from computer:', error);
    res.status(500).json({ 
      error: 'Failed to remove item from computer',
      details: error.message
    });
  }
});

module.exports = router;
