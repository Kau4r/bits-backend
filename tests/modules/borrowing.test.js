const request = require('supertest');
const prisma = require('../__mocks__/prisma');

jest.mock('../../src/middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      User_ID: 9999,
      Email: 'labtech@test.com',
      First_Name: 'Lab',
      Last_Name: 'Tech',
      User_Role: 'LAB_TECH',
      Is_Active: true,
    };
    next();
  },
  JWT_SECRET: 'test-secret',
}));

jest.mock('../../src/utils/auditLogger', () => ({
  logBorrowing: jest.fn().mockResolvedValue({}),
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

describe('Borrowing Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PATCH /borrowing/:id/approve', () => {
    it('approves a type-only borrowing request when a specific item is assigned', async () => {
      prisma.borrow_Item.findUnique.mockResolvedValue({
        Borrow_Item_ID: 1,
        Borrower_ID: 2,
        Borrowee_ID: 2,
        Item_ID: null,
        Item: null,
        Requested_Item_Type: 'HDMI',
        Status: 'PENDING',
        Borrower: {
          First_Name: 'Faculty',
          Last_Name: 'User',
        },
      });
      prisma.item.findUnique.mockResolvedValue({
        Item_ID: 10,
        Item_Type: 'HDMI',
        Item_Code: 'HDMI-001',
        Status: 'AVAILABLE',
      });
      prisma.borrow_Item.update.mockResolvedValue({
        Borrow_Item_ID: 1,
        Item_ID: 10,
        Status: 'BORROWED',
      });
      prisma.item.update.mockResolvedValue({
        Item_ID: 10,
        Status: 'BORROWED',
      });

      const res = await request(app)
        .patch('/borrowing/1/approve')
        .send({ assignedItemId: 10 });

      expect(res.status).toBe(200);
      expect(prisma.borrow_Item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Status: 'BORROWED',
            Item_ID: 10,
            Borrowee_ID: 9999,
          }),
        })
      );
      expect(prisma.item.update).toHaveBeenCalledWith({
        where: { Item_ID: 10 },
        data: { Status: 'BORROWED' },
      });
    });
  });

  describe('PATCH /borrowing/:id/reject', () => {
    it('rejects a type-only borrowing request even when no item is assigned yet', async () => {
      prisma.borrow_Item.findUnique.mockResolvedValue({
        Borrow_Item_ID: 1,
        Borrower_ID: 2,
        Borrowee_ID: 2,
        Item_ID: null,
        Item: null,
        Requested_Item_Type: 'HDMI',
        Status: 'PENDING',
        Borrower: {
          First_Name: 'Faculty',
          Last_Name: 'User',
        },
      });
      prisma.borrow_Item.update.mockResolvedValue({
        Borrow_Item_ID: 1,
        Item_ID: null,
        Status: 'REJECTED',
      });

      const res = await request(app)
        .patch('/borrowing/1/reject')
        .send({ reason: 'Not available' });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Rejected borrow request for HDMI');
      expect(prisma.borrow_Item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            Status: 'REJECTED',
            Borrowee_ID: 9999,
          },
        })
      );
    });
  });
});
