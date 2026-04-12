const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

// Create Ticket
const createTicket = async (req, res) => {
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
        success: false, error: 'Reported_By_ID and Report_Problem are required',
      });
    }

    // Validate Room_ID if provided
    if (Room_ID) {
      const roomExists = await prisma.room.findUnique({
        where: { Room_ID: parseInt(Room_ID) }
      });
      if (!roomExists) {
        return res.status(400).json({ success: false, error: 'Invalid Room_ID: Room does not exist' });
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

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Failed to create ticket' });
  }
};

// Get ticket count by status
const getTicketCount = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.Status = status;

    const count = await prisma.ticket.count({ where });
    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error counting tickets:', error);
    res.status(500).json({ success: false, error: 'Failed to count tickets' });
  }
};

// Get all tickets (optionally filter by status)
const getTickets = async (req, res) => {
  try {
    const { status, technicianId, excludeStatus, unassigned } = req.query;
    const where = {};

    if (status) where.Status = status;
    if (technicianId) where.Technician_ID = parseInt(technicianId);
    if (unassigned === 'true') where.Technician_ID = null;
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


    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
};

// Update ticket (status, priority, category)
const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { Status, Priority, Category, Archived, Technician_ID } = req.body;
    const requestedTechnicianId = Technician_ID === undefined
      ? undefined
      : Technician_ID === null
        ? null
        : parseInt(Technician_ID);

    if (Number.isNaN(requestedTechnicianId) ||
      (typeof requestedTechnicianId === 'number' && requestedTechnicianId <= 0)) {
      return res.status(400).json({ success: false, error: 'Invalid Technician_ID' });
    }

    // Validate status if provided
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'RESOLVED'];
    if (Status && !validStatuses.includes(Status)) {
      return res.status(400).json({
        success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Get existing ticket to check for changes
    const existingTicket = await prisma.ticket.findUnique({
      where: { Ticket_ID: parseInt(id) }
    });

    if (!existingTicket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const nextTechnicianId = requestedTechnicianId === undefined
      ? existingTicket.Technician_ID
      : requestedTechnicianId;
    const isUnassigningTicket = requestedTechnicianId === null;
    const isUnassignReset = isUnassigningTicket && Status === 'PENDING';
    const hasStatusUpdate = Status !== undefined && Status !== existingTicket.Status;
    const hasPriorityUpdate = Priority !== undefined && Priority !== existingTicket.Priority;
    const hasCategoryUpdate = Category !== undefined && Category !== existingTicket.Category;
    const requiresAssignedTechnician = (hasStatusUpdate && !isUnassignReset) ||
      hasPriorityUpdate ||
      hasCategoryUpdate;

    if (requiresAssignedTechnician && !nextTechnicianId) {
      return res.status(400).json({
        success: false,
        error: 'Assign the ticket to a Lab Tech before updating details or status'
      });
    }

    // Validate target technician is active
    if (requestedTechnicianId) {
      const targetTech = await prisma.user.findUnique({
        where: { User_ID: requestedTechnicianId }
      });
      if (!targetTech) {
        return res.status(400).json({ success: false, error: 'Technician not found' });
      }
      if (targetTech.User_Role !== 'LAB_TECH') {
        return res.status(400).json({ success: false, error: 'Ticket must be assigned to a Lab Tech' });
      }
      if (!targetTech.Is_Active) {
        return res.status(400).json({ success: false, error: 'Cannot assign to inactive technician' });
      }
    }

    const updatedTicket = await prisma.ticket.update({
      where: { Ticket_ID: parseInt(id) },
      data: {
        Status,
        Priority,
        Category,
        Archived,
        Technician_ID: requestedTechnicianId,
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
    const newTechId = requestedTechnicianId || null;

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

    res.json({ success: true, data: updatedTicket });
  } catch (error) {
    console.error(`Error updating ticket ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to update ticket' });
  }
};

// Get single ticket
const getTicketById = async (req, res) => {
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
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error(`Error fetching ticket ${req.params.id}:`, error);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket' });
  }
};

module.exports = {
  createTicket,
  getTicketCount,
  getTickets,
  updateTicket,
  getTicketById
};
