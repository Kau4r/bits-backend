const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NotificationService = require('../src/services/notificationService');
const AuditLogger = require('../src/utils/auditLogger');

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

    // Validate Room_ID if provided
    if (Room_ID) {
      const roomExists = await prisma.room.findUnique({
        where: { Room_ID: parseInt(Room_ID) }
      });
      if (!roomExists) {
        return res.status(400).json({ error: 'Invalid Room_ID: Room does not exist' });
      }
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

    // Log and notify Lab Techs and Lab Head about the new ticket
    const ticketDetails = `New ticket reported: ${Report_Problem.substring(0, 50)}${Report_Problem.length > 50 ? '...' : ''}`;

    // Notify both Lab Techs and Lab Head in one call to avoid duplicates
    await AuditLogger.logTicket(
      parseInt(Reported_By_ID),
      'TICKET_CREATED',
      ticket.Ticket_ID,
      ticketDetails,
      ['LAB_TECH', 'LAB_HEAD']
    );

    res.status(201).json(ticket);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create ticket', details: error.message });
  }
});

// Get ticket count by status
router.get('/count', async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.Status = status;

    const count = await prisma.ticket.count({ where });
    res.json({ count });
  } catch (error) {
    console.error('Error counting tickets:', error);
    res.status(500).json({ error: 'Failed to count tickets' });
  }
});

// Get all tickets (optionally filter by status)
router.get('/', async (req, res) => {
  try {
    const { status, technicianId, excludeStatus } = req.query;
    const where = {};

    if (status) where.Status = status;
    if (technicianId) where.Technician_ID = parseInt(technicianId);
    if (excludeStatus) {
      where.Status = { not: excludeStatus };
    }

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

    // Get existing ticket to check for changes
    const existingTicket = await prisma.ticket.findUnique({
      where: { Ticket_ID: parseInt(id) }
    });

    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
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

    // Check for technician assignment
    let notificationSent = false;
    const newTechId = Technician_ID ? parseInt(Technician_ID) : null;

    // Check if technician changed (handling newly assigned or re-assigned)
    if (newTechId && newTechId !== existingTicket.Technician_ID) {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Reported_By_ID, // Use current user or original reporter
        'TICKET_ASSIGNED',
        updatedTicket.Ticket_ID,
        `Ticket assigned to ${updatedTicket.Technician.First_Name} ${updatedTicket.Technician.Last_Name}`,
        ['LAB_TECH', 'LAB_HEAD'],
        newTechId // Notify the technician
      );
      notificationSent = true;
    }

    // Check for resolution
    if (Status === 'RESOLVED' && existingTicket.Status !== 'RESOLVED') {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Technician_ID || existingTicket.Reported_By_ID,
        'TICKET_RESOLVED',
        updatedTicket.Ticket_ID,
        `Ticket resolved: ${updatedTicket.Report_Problem.substring(0, 30)}...`,
        ['LAB_TECH', 'LAB_HEAD'],
        updatedTicket.Reported_By_ID // Notify the reporter
      );
      notificationSent = true;
    }

    // Only notify Staff of generic updates if no specific notification was sent AND actual meaningful changes occurred
    const hasOtherChanges = (Status && Status !== existingTicket.Status) ||
      (Priority && Priority !== existingTicket.Priority) ||
      (Category && Category !== existingTicket.Category);

    if (!notificationSent && hasOtherChanges) {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Reported_By_ID,
        'TICKET_UPDATED',
        updatedTicket.Ticket_ID,
        `Ticket updated via System`,
        ['LAB_TECH', 'LAB_HEAD']
      );
    }

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
