const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create a new ticket
router.post('/', async (req, res) => {
  try {
    const { User_ID, Title, Description } = req.body;

    // Validate required fields
    if (!User_ID || !Title || !Description) {
      return res.status(400).json({
        error: 'User_ID, Title, and Description are required'
      });
    }

    // Create the ticket with status 'PENDING'
    const ticket = await prisma.Ticket.create({
      data: {
        User_ID: parseInt(User_ID),
        Title,
        Description,
        Status: 'PENDING',
        // Created_At and Updated_At are automatically handled by Prisma
      },
      include: {
        User: {
          select: {
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        }
      }
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({
      error: 'Failed to create ticket',
      details: error.message
    });
  }
});

// Get all tickets (with filtering by status)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    
    if (status) {
      where.Status = status;
    }

    const tickets = await prisma.Ticket.findMany({
      where,
      include: {
        User: {
          select: {
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        }
      },
      orderBy: {
        Created_At: 'desc'
      }
    });

    res.json(tickets);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      error: 'Failed to fetch tickets',
      details: error.message
    });
  }
});

// Update ticket status (for lab techs)
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // Validate required fields
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Validate status value
    const validStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    const updateData = {
      Status: status,
      Updated_At: new Date()
    };

    const updatedTicket = await prisma.Ticket.update({
      where: { Ticket_ID: parseInt(id) },
      data: updateData,
      include: {
        User: {
          select: {
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        }
      }
    });

    res.json(updatedTicket);
  } catch (error) {
    console.error(`Error updating ticket ${id}:`, error);
    res.status(500).json({
      error: 'Failed to update ticket status',
      details: error.message
    });
  }
});

// Get ticket by ID
router.get('/:id', async (req, res) => {
  try {
    const ticket = await prisma.Ticket.findUnique({
      where: { Ticket_ID: parseInt(req.params.id) },
      include: {
        User: {
          select: {
            First_Name: true,
            Last_Name: true,
            Email: true
          }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(ticket);
  } catch (error) {
    console.error(`Error fetching ticket ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to fetch ticket',
      details: error.message
    });
  }
});

module.exports = router;
