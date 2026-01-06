const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Ticket
router.post('/', async (req, res) => {
  try {
    const {
      Reported_By_ID,
      Report_Problem,
      Location,
      Item_ID,
      Room_ID,
      Status,
      Priority,
      Category,
    } = req.body;

    if (!Reported_By_ID || !Report_Problem) {
      return res.status(400).json({
        error: 'Reported_By_ID and Report_Problem are required',
      });
    }

    const ticket = await prisma.ticket.create({
      data: {
        Reported_By_ID: parseInt(Reported_By_ID),
        Report_Problem,
        Location,
        Item_ID: Item_ID ? parseInt(Item_ID) : undefined,
        Room_ID: Room_ID ? parseInt(Room_ID) : undefined,
        Status: Status || 'PENDING',
        Priority,
        Category,
      },
      include: {
        Reported_By: {
          select: { User_ID: true, First_Name: true, Last_Name: true, Email: true, User_Role: true },
        },
        Item: {
          include: { Room: true },
        },
        Technician: {
          select: { User_ID: true, First_Name: true, Last_Name: true, Email: true, User_Role: true },
        },
        Room: true,
      },
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create ticket', details: error.message });
  }
});

// Get all tickets (optionally filter by status)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};

    if (status) where.Status = status;

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        Reported_By: true,
        Technician: true,
        Item: { include: { Room: true } },
        Room: true,
        AuditLogs: true,
      },
      orderBy: { Created_At: 'desc' },
    });


    res.json(tickets);
  } catch (error) {
    console.error("Ticket creation error:", error);
    res.status(500).json({
      error: "Failed to create ticket",
      details: error instanceof Error ? error.message : String(error),
      meta: error
    });
  }
});

// Update ticket (status, priority, category)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { Status, Priority, Category, Archived, Technician_ID } = req.body;

    // Validate status if provided
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'RESOLVED'];
    if (Status && !validStatuses.includes(Status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const updatedTicket = await prisma.ticket.update({
      where: { Ticket_ID: parseInt(id) },
      data: {
        Status,
        Priority,
        Category,
        Archived,
        Technician_ID: Technician_ID === null ? null : (Technician_ID !== undefined ? parseInt(Technician_ID) : undefined),
      },
      include: {
        Reported_By: true,
        Item: { include: { Room: true } },
        Technician: true,
        Room: true,
      },
    });

    res.json(updatedTicket);
  } catch (error) {
    console.error(`Error updating ticket ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to update ticket', details: error.message });
  }
});

// Get single ticket
router.get('/:id', async (req, res) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { Ticket_ID: parseInt(req.params.id) },
      include: {
        Reported_By: true,
        Item: { include: { Room: true } },
        Technician: true,
        Room: true,
      },
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(ticket);
  } catch (error) {
    console.error(`Error fetching ticket ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch ticket', details: error.message });
  }
});

module.exports = router;
