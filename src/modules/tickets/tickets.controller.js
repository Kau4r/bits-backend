const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'RESOLVED'];
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_CATEGORIES = ['HARDWARE', 'SOFTWARE', 'FACILITY', 'OTHER'];

const ticketInclude = {
  Reported_By: true,
  Item: { include: { Room: true } },
  Technician: true,
  Room: true,
};

const parseRequiredId = (value, fieldName) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { error: `${fieldName} must be a positive number` };
  }
  return { value: parsed };
};

const parseOptionalId = (value, fieldName) => {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { provided: true, error: `${fieldName} must be a positive number or null` };
  }

  return { provided: true, value: parsed };
};

const normalizeRequiredText = (value, fieldName) => {
  if (value === undefined || value === null) {
    return { error: `${fieldName} is required` };
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return { error: `${fieldName} cannot be empty` };
  }

  return { value: normalized };
};

const normalizeOptionalText = (value) => {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null) return { provided: true, value: null };

  const normalized = String(value).trim();
  return { provided: true, value: normalized || null };
};

const normalizeOptionalEnum = (value, fieldName, validValues) => {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };

  const normalized = String(value).trim().toUpperCase();
  if (!validValues.includes(normalized)) {
    return {
      provided: true,
      error: `Invalid ${fieldName}. Must be one of: ${validValues.join(', ')}`
    };
  }

  return { provided: true, value: normalized };
};

const normalizeOptionalBoolean = (value, fieldName) => {
  if (value === undefined) return { provided: false, value: undefined };
  if (typeof value === 'boolean') return { provided: true, value };
  if (value === 'true') return { provided: true, value: true };
  if (value === 'false') return { provided: true, value: false };
  return { provided: true, error: `${fieldName} must be true or false` };
};

const validateRoom = async (roomId) => {
  if (roomId === null || roomId === undefined) return null;

  const room = await prisma.room.findUnique({ where: { Room_ID: roomId } });
  return room ? null : 'Invalid Room_ID: Room does not exist';
};

const validateItem = async (itemId) => {
  if (itemId === null || itemId === undefined) return null;

  const item = await prisma.item.findUnique({ where: { Item_ID: itemId } });
  return item ? null : 'Invalid Item_ID: Item does not exist';
};

const validateLabTechAssignment = async (technicianId) => {
  const targetTech = await prisma.user.findUnique({
    where: { User_ID: technicianId }
  });

  if (!targetTech) {
    return { error: 'Technician not found' };
  }
  if (targetTech.User_Role !== 'LAB_TECH') {
    return { error: 'Ticket must be assigned to a Lab Tech' };
  }
  if (!targetTech.Is_Active) {
    return { error: 'Cannot assign to inactive technician' };
  }

  return { technician: targetTech };
};

const sendValidationError = (res, error) => {
  return res.status(400).json({ success: false, error });
};

// Create Ticket
const createTicket = async (req, res) => {
  try {
    const reporterResult = parseRequiredId(req.body.Reported_By_ID ?? req.user?.User_ID, 'Reported_By_ID');
    if (reporterResult.error) return sendValidationError(res, reporterResult.error);

    const problemResult = normalizeRequiredText(req.body.Report_Problem, 'Report_Problem');
    if (problemResult.error) return sendValidationError(res, problemResult.error);

    const statusResult = normalizeOptionalEnum(req.body.Status, 'Status', VALID_STATUSES);
    const priorityResult = normalizeOptionalEnum(req.body.Priority, 'Priority', VALID_PRIORITIES);
    const categoryResult = normalizeOptionalEnum(req.body.Category, 'Category', VALID_CATEGORIES);
    const roomResult = parseOptionalId(req.body.Room_ID, 'Room_ID');
    const itemResult = parseOptionalId(req.body.Item_ID, 'Item_ID');
    const locationResult = normalizeOptionalText(req.body.Location);

    for (const result of [statusResult, priorityResult, categoryResult, roomResult, itemResult]) {
      if (result.error) return sendValidationError(res, result.error);
    }

    const roomError = await validateRoom(roomResult.value);
    if (roomError) return sendValidationError(res, roomError);

    const itemError = await validateItem(itemResult.value);
    if (itemError) return sendValidationError(res, itemError);

    const ticket = await prisma.ticket.create({
      data: {
        Reported_By_ID: reporterResult.value,
        Report_Problem: problemResult.value,
        ...(locationResult.provided ? { Location: locationResult.value } : {}),
        ...(itemResult.provided ? { Item_ID: itemResult.value } : {}),
        ...(roomResult.provided ? { Room_ID: roomResult.value } : {}),
        Status: statusResult.value || 'PENDING',
        ...(priorityResult.provided ? { Priority: priorityResult.value } : {}),
        ...(categoryResult.provided ? { Category: categoryResult.value } : {}),
      },
      include: ticketInclude,
    });

    const ticketDetails = `New ticket reported: ${problemResult.value.substring(0, 50)}${problemResult.value.length > 50 ? '...' : ''}`;

    await AuditLogger.logTicket(
      reporterResult.value,
      'TICKET_CREATED',
      ticket.Ticket_ID,
      ticketDetails,
      ['LAB_TECH', 'LAB_HEAD']
    );

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ success: false, error: 'Failed to create ticket' });
  }
};

// Get ticket count by status
const getTicketCount = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};

    if (status) {
      const statusResult = normalizeOptionalEnum(status, 'status', VALID_STATUSES);
      if (statusResult.error) return sendValidationError(res, statusResult.error);
      where.Status = statusResult.value;
    }

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

    if (status) {
      const statusResult = normalizeOptionalEnum(status, 'status', VALID_STATUSES);
      if (statusResult.error) return sendValidationError(res, statusResult.error);
      where.Status = statusResult.value;
    }

    if (technicianId) {
      const techResult = parseRequiredId(technicianId, 'technicianId');
      if (techResult.error) return sendValidationError(res, techResult.error);
      where.Technician_ID = techResult.value;
    }

    if (unassigned === 'true') where.Technician_ID = null;

    if (excludeStatus) {
      const statusResult = normalizeOptionalEnum(excludeStatus, 'excludeStatus', VALID_STATUSES);
      if (statusResult.error) return sendValidationError(res, statusResult.error);
      where.Status = { not: statusResult.value };
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        ...ticketInclude,
        AuditLogs: true,
      },
      orderBy: { Created_At: 'desc' },
    });

    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
};

// Update ticket details/status/assignment/archive state
const updateTicket = async (req, res) => {
  try {
    const idResult = parseRequiredId(req.params.id, 'Ticket_ID');
    if (idResult.error) return sendValidationError(res, idResult.error);

    const statusResult = normalizeOptionalEnum(req.body.Status, 'Status', VALID_STATUSES);
    const priorityResult = normalizeOptionalEnum(req.body.Priority, 'Priority', VALID_PRIORITIES);
    const categoryResult = normalizeOptionalEnum(req.body.Category, 'Category', VALID_CATEGORIES);
    const archiveResult = normalizeOptionalBoolean(req.body.Archived, 'Archived');
    const technicianResult = parseOptionalId(req.body.Technician_ID, 'Technician_ID');
    const itemResult = parseOptionalId(req.body.Item_ID, 'Item_ID');
    const roomResult = parseOptionalId(req.body.Room_ID, 'Room_ID');
    const problemResult = req.body.Report_Problem === undefined
      ? { provided: false, value: undefined }
      : { provided: true, ...normalizeRequiredText(req.body.Report_Problem, 'Report_Problem') };
    const locationResult = normalizeOptionalText(req.body.Location);

    for (const result of [statusResult, priorityResult, categoryResult, archiveResult, technicianResult, itemResult, roomResult, problemResult]) {
      if (result.error) return sendValidationError(res, result.error);
    }

    const existingTicket = await prisma.ticket.findUnique({
      where: { Ticket_ID: idResult.value }
    });

    if (!existingTicket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const roomError = await validateRoom(roomResult.value);
    if (roomError) return sendValidationError(res, roomError);

    const itemError = await validateItem(itemResult.value);
    if (itemError) return sendValidationError(res, itemError);

    const requestedTechnicianId = technicianResult.value;
    const nextTechnicianId = technicianResult.provided ? requestedTechnicianId : existingTicket.Technician_ID;
    const isAssigningTicket = technicianResult.provided && requestedTechnicianId !== null && requestedTechnicianId !== existingTicket.Technician_ID;
    const isUnassigningTicket = technicianResult.provided && requestedTechnicianId === null;

    let nextStatus = statusResult.provided ? statusResult.value : existingTicket.Status;
    if (isAssigningTicket && !statusResult.provided && existingTicket.Status === 'PENDING') {
      nextStatus = 'IN_PROGRESS';
    }
    if (isUnassigningTicket && !statusResult.provided) {
      nextStatus = 'PENDING';
    }

    const hasStatusUpdate = nextStatus !== existingTicket.Status;
    const hasPriorityUpdate = priorityResult.provided && priorityResult.value !== existingTicket.Priority;
    const hasCategoryUpdate = categoryResult.provided && categoryResult.value !== existingTicket.Category;
    const hasReportProblemUpdate = problemResult.provided && problemResult.value !== existingTicket.Report_Problem;
    const hasLocationUpdate = locationResult.provided && locationResult.value !== (existingTicket.Location ?? null);
    const hasItemUpdate = itemResult.provided && itemResult.value !== (existingTicket.Item_ID ?? null);
    const hasRoomUpdate = roomResult.provided && roomResult.value !== (existingTicket.Room_ID ?? null);
    const isUnassignReset = isUnassigningTicket && nextStatus === 'PENDING';

    const requiresAssignedTechnician = (hasStatusUpdate && !isUnassignReset) ||
      hasPriorityUpdate ||
      hasCategoryUpdate ||
      hasReportProblemUpdate ||
      hasLocationUpdate ||
      hasItemUpdate ||
      hasRoomUpdate;

    if (requiresAssignedTechnician && !nextTechnicianId) {
      return sendValidationError(res, 'Assign the ticket to a Lab Tech before updating details or status');
    }

    if (requestedTechnicianId) {
      const validation = await validateLabTechAssignment(requestedTechnicianId);
      if (validation.error) return sendValidationError(res, validation.error);
    } else if (requiresAssignedTechnician && nextTechnicianId) {
      const validation = await validateLabTechAssignment(nextTechnicianId);
      if (validation.error) return sendValidationError(res, validation.error);
    }

    const updateData = {};
    if (hasStatusUpdate || statusResult.provided || isUnassigningTicket || isAssigningTicket) updateData.Status = nextStatus;
    if (priorityResult.provided) updateData.Priority = priorityResult.value;
    if (categoryResult.provided) updateData.Category = categoryResult.value;
    if (archiveResult.provided) updateData.Archived = archiveResult.value;
    if (technicianResult.provided) updateData.Technician_ID = requestedTechnicianId;
    if (problemResult.provided) updateData.Report_Problem = problemResult.value;
    if (locationResult.provided) updateData.Location = locationResult.value;
    if (itemResult.provided) updateData.Item_ID = itemResult.value;
    if (roomResult.provided) updateData.Room_ID = roomResult.value;

    if (Object.keys(updateData).length === 0) {
      return sendValidationError(res, 'No ticket update fields provided');
    }

    const updatedTicket = await prisma.ticket.update({
      where: { Ticket_ID: idResult.value },
      data: updateData,
      include: ticketInclude,
    });

    let notificationSent = false;

    if (isAssigningTicket && updatedTicket.Technician) {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Reported_By_ID,
        'TICKET_ASSIGNED',
        updatedTicket.Ticket_ID,
        `Ticket assigned to ${updatedTicket.Technician.First_Name} ${updatedTicket.Technician.Last_Name}`,
        ['LAB_TECH', 'LAB_HEAD'],
        requestedTechnicianId
      );
      notificationSent = true;
    }

    if (updateData.Status === 'RESOLVED' && existingTicket.Status !== 'RESOLVED') {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Technician_ID || existingTicket.Reported_By_ID,
        'TICKET_RESOLVED',
        updatedTicket.Ticket_ID,
        `Ticket resolved: ${updatedTicket.Report_Problem.substring(0, 30)}...`,
        ['LAB_TECH', 'LAB_HEAD'],
        updatedTicket.Reported_By_ID
      );
      notificationSent = true;
    }

    if (archiveResult.provided && archiveResult.value !== existingTicket.Archived) {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Reported_By_ID,
        archiveResult.value ? 'TICKET_ARCHIVED' : 'TICKET_UPDATED',
        updatedTicket.Ticket_ID,
        archiveResult.value ? 'Ticket archived' : 'Ticket restored',
        ['LAB_TECH', 'LAB_HEAD']
      );
      notificationSent = true;
    }

    const hasOtherChanges = hasStatusUpdate ||
      hasPriorityUpdate ||
      hasCategoryUpdate ||
      hasReportProblemUpdate ||
      hasLocationUpdate ||
      hasItemUpdate ||
      hasRoomUpdate ||
      isUnassigningTicket;

    if (!notificationSent && hasOtherChanges) {
      await AuditLogger.logTicket(
        req.user ? req.user.User_ID : existingTicket.Reported_By_ID,
        'TICKET_UPDATED',
        updatedTicket.Ticket_ID,
        'Ticket updated via System',
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
    const idResult = parseRequiredId(req.params.id, 'Ticket_ID');
    if (idResult.error) return sendValidationError(res, idResult.error);

    const ticket = await prisma.ticket.findUnique({
      where: { Ticket_ID: idResult.value },
      include: ticketInclude,
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
