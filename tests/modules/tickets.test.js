const request = require('supertest');
const prisma = require('../__mocks__/prisma');

jest.mock('../../src/middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      User_ID: 9999,
      Email: 'admin@test.com',
      First_Name: 'Test',
      Last_Name: 'Admin',
      User_Role: 'ADMIN',
      Is_Active: true,
    };
    next();
  },
  JWT_SECRET: 'test-secret',
}));

jest.mock('../../src/utils/auditLogger', () => ({
  logTicket: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/notificationManager', () => ({
  add: jest.fn(),
  remove: jest.fn(),
  send: jest.fn(),
  broadcastBookingEvent: jest.fn().mockResolvedValue(undefined),
  clients: new Map(),
}));

jest.mock('../../src/services/notificationService', () => ({
  notifyRole: jest.fn().mockResolvedValue(undefined),
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

const { app } = require('../app');

describe('Ticket Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /tickets', () => {
    it('creates a ticket with valid normalized data', async () => {
      const createdTicket = {
        Ticket_ID: 7,
        Reported_By_ID: 2,
        Report_Problem: 'PC issue',
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'HARDWARE',
        Archived: false,
      };

      prisma.ticket.create.mockResolvedValue(createdTicket);

      const res = await request(app)
        .post('/tickets')
        .send({
          Reported_By_ID: 2,
          Report_Problem: '  PC issue  ',
          Priority: 'LOW',
          Category: 'HARDWARE',
          Status: 'PENDING',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(createdTicket);
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Reported_By_ID: 2,
            Report_Problem: 'PC issue',
            Priority: 'LOW',
            Category: 'HARDWARE',
            Status: 'PENDING',
          }),
        })
      );
    });

    it('rejects priority values that are not in the Prisma enum', async () => {
      const res = await request(app)
        .post('/tickets')
        .send({
          Reported_By_ID: 2,
          Report_Problem: 'PC issue',
          Priority: 'URGENT',
          Category: 'HARDWARE',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation error');
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /tickets/:id', () => {
    it('rejects detail or status updates before a Lab Tech is assigned', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Status: 'IN_PROGRESS', Report_Problem: 'Updated printer issue' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Assign the ticket to a Lab Tech');
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('allows assigning a ticket to an active Lab Tech', async () => {
      const existingTicket = {
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
      };
      const updatedTicket = {
        ...existingTicket,
        Technician_ID: 3,
        Status: 'IN_PROGRESS',
        Technician: {
          User_ID: 3,
          First_Name: 'Lab',
          Last_Name: 'Tech',
          User_Role: 'LAB_TECH',
          Is_Active: true,
        },
        Report_Problem: 'Printer issue',
      };

      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        User_ID: 3,
        User_Role: 'LAB_TECH',
        Is_Active: true,
      });
      prisma.ticket.update.mockResolvedValue(updatedTicket);

      const res = await request(app)
        .put('/tickets/1')
        .send({ Technician_ID: 3, Status: 'IN_PROGRESS' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(updatedTicket);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Technician_ID: 3,
            Status: 'IN_PROGRESS',
          }),
        })
      );
    });

    it('auto-starts a pending ticket when assigning only a Lab Tech', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
      });
      prisma.user.findUnique.mockResolvedValue({
        User_ID: 3,
        User_Role: 'LAB_TECH',
        Is_Active: true,
      });
      prisma.ticket.update.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: 3,
        Status: 'IN_PROGRESS',
        Technician: {
          User_ID: 3,
          First_Name: 'Lab',
          Last_Name: 'Tech',
        },
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Technician_ID: 3 });

      expect(res.status).toBe(200);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Technician_ID: 3,
            Status: 'IN_PROGRESS',
          }),
        })
      );
    });

    it('rejects assignment to a non-Lab-Tech user', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
      });
      prisma.user.findUnique.mockResolvedValue({
        User_ID: 4,
        User_Role: 'LAB_HEAD',
        Is_Active: true,
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Technician_ID: 4 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Lab Tech');
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('allows detail updates after the ticket is assigned to an active Lab Tech', async () => {
      const existingTicket = {
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: 3,
        Status: 'IN_PROGRESS',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
        Location: 'Lab 1',
        Item_ID: null,
        Room_ID: null,
      };
      const updatedTicket = {
        ...existingTicket,
        Priority: 'HIGH',
        Report_Problem: 'Printer issue with error code',
        Location: 'Lab 2',
      };

      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        User_ID: 3,
        User_Role: 'LAB_TECH',
        Is_Active: true,
      });
      prisma.ticket.update.mockResolvedValue(updatedTicket);

      const res = await request(app)
        .put('/tickets/1')
        .send({
          Priority: 'HIGH',
          Report_Problem: '  Printer issue with error code  ',
          Location: 'Lab 2',
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(updatedTicket);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Priority: 'HIGH',
            Report_Problem: 'Printer issue with error code',
            Location: 'Lab 2',
          }),
        })
      );
    });

    it('allows resolving an assigned ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: 3,
        Status: 'IN_PROGRESS',
        Priority: 'LOW',
        Category: 'SOFTWARE',
        Report_Problem: 'Printer issue',
      });
      prisma.user.findUnique.mockResolvedValue({
        User_ID: 3,
        User_Role: 'LAB_TECH',
        Is_Active: true,
      });
      prisma.ticket.update.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: 3,
        Status: 'RESOLVED',
        Archived: true,
        Report_Problem: 'Printer issue',
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Status: 'RESOLVED' });

      expect(res.status).toBe(200);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ Status: 'RESOLVED', Archived: true }),
        })
      );
    });

    it('archives an unassigned ticket without requiring a technician', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Archived: false,
        Report_Problem: 'Printer issue',
      });
      prisma.ticket.update.mockResolvedValue({
        Ticket_ID: 1,
        Archived: true,
        Report_Problem: 'Printer issue',
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Archived: true });

      expect(res.status).toBe(200);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { Archived: true },
        })
      );
    });

    it('restores an archived ticket without requiring a technician', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Archived: true,
        Report_Problem: 'Printer issue',
      });
      prisma.ticket.update.mockResolvedValue({
        Ticket_ID: 1,
        Archived: false,
        Report_Problem: 'Printer issue',
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Archived: false });

      expect(res.status).toBe(200);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { Archived: false },
        })
      );
    });
  });
});
