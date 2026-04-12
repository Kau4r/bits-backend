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

  describe('PUT /tickets/:id', () => {
    it('rejects detail or status updates before a Lab Tech is assigned', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
      });

      const res = await request(app)
        .put('/tickets/1')
        .send({ Status: 'IN_PROGRESS' });

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

    it('rejects assignment to a non-Lab-Tech user', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        Ticket_ID: 1,
        Reported_By_ID: 2,
        Technician_ID: null,
        Status: 'PENDING',
        Priority: 'LOW',
        Category: 'SOFTWARE',
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
  });
});
