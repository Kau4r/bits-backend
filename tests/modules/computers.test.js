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
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  JWT_SECRET: 'test-secret',
}));

jest.mock('../../src/utils/auditLogger', () => ({
  log: jest.fn().mockResolvedValue({}),
  logAuth: jest.fn().mockResolvedValue({}),
  logBooking: jest.fn().mockResolvedValue({}),
  logInventory: jest.fn().mockResolvedValue({}),
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

const computer = (overrides = {}) => ({
  Computer_ID: 1,
  Name: 'PC 1',
  Created_At: new Date('2026-01-01T00:00:00.000Z'),
  Updated_At: new Date('2026-01-01T00:00:00.000Z'),
  Status: 'AVAILABLE',
  Room_ID: 1,
  Mac_Address: null,
  IP_Address: null,
  Last_Seen: null,
  Is_Online: false,
  Current_User_ID: null,
  Room: { Room_ID: 1, Name: 'LB 400', Room_Type: 'LAB' },
  Item: [],
  ...overrides,
});

describe('Computer Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /computers', () => {
    it('returns room computers with stable display numbering', async () => {
      prisma.computer.findMany.mockResolvedValue([
        computer({ Computer_ID: 10, Name: 'PC 10', Created_At: new Date('2026-01-10T00:00:00.000Z') }),
        computer({ Computer_ID: 2, Name: 'PC 2', Created_At: new Date('2026-01-02T00:00:00.000Z') }),
        computer({ Computer_ID: 5, Name: 'Faculty terminal', Created_At: new Date('2026-01-05T00:00:00.000Z') }),
      ]);

      const res = await request(app).get('/computers?roomId=1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map(c => c.Name)).toEqual(['PC 2', 'PC 10', 'Faculty terminal']);
      expect(res.body.data.map(c => c.Display_Name)).toEqual(['PC 1', 'PC 2', 'PC 3']);
      expect(res.body.data.map(c => c.Display_Number)).toEqual([1, 2, 3]);
      expect(prisma.computer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Room_ID: 1 },
        })
      );
    });

    it('rejects an invalid room filter', async () => {
      const res = await request(app).get('/computers?roomId=bad');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(prisma.computer.findMany).not.toHaveBeenCalled();
    });
  });

  describe('PUT /computers/:id', () => {
    it('moves assigned components with the computer when its room changes', async () => {
      const existingComputer = computer({
        Computer_ID: 7,
        Room_ID: 1,
        Item: [
          { Item_ID: 21 },
          { Item_ID: 22 },
        ],
      });
      const updatedComputer = computer({
        Computer_ID: 7,
        Room_ID: 2,
        Room: { Room_ID: 2, Name: 'LB 401', Room_Type: 'LAB' },
        Item: existingComputer.Item,
      });

      prisma.computer.findUnique
        .mockResolvedValueOnce(existingComputer)
        .mockResolvedValueOnce(updatedComputer);
      prisma.room.findUnique.mockResolvedValue({ Room_ID: 2, Name: 'LB 401' });
      prisma.computer.update.mockResolvedValue({ ...existingComputer, Room_ID: 2 });
      prisma.item.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .put('/computers/7')
        .send({ roomId: 2 });

      expect(res.status).toBe(200);
      expect(prisma.item.updateMany).toHaveBeenCalledWith({
        where: { Item_ID: { in: [21, 22] } },
        data: { Room_ID: 2 },
      });
      expect(res.body.data.Room_ID).toBe(2);
    });
  });
});
