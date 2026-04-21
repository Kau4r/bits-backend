const request = require('supertest');
const prisma = require('../__mocks__/prisma');

// Mock the auth middleware
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

// Mock the audit logger
jest.mock('../../src/utils/auditLogger', () => ({
  log: jest.fn().mockResolvedValue({}),
  logAuth: jest.fn().mockResolvedValue({}),
  logBooking: jest.fn().mockResolvedValue({}),
  logInventory: jest.fn().mockResolvedValue({}),
}));

// Mock notification services
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

describe('Inventory Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /inventory', () => {
    it('should return all items', async () => {
      const mockItems = [
        { Item_ID: 1, Item_Code: 'ITM-2026-001', Brand: 'Dell', Status: 'AVAILABLE' },
        { Item_ID: 2, Item_Code: 'ITM-2026-002', Brand: 'HP', Status: 'BORROWED' },
      ];
      prisma.item.findMany.mockResolvedValue(mockItems);

      const res = await request(app).get('/inventory');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockItems);
    });

    it('should filter by roomId', async () => {
      prisma.item.findMany.mockResolvedValue([]);

      const res = await request(app).get('/inventory?roomId=1');

      expect(res.status).toBe(200);
      expect(prisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ Room_ID: 1 }),
        })
      );
    });

    it('should filter by status', async () => {
      prisma.item.findMany.mockResolvedValue([]);

      const res = await request(app).get('/inventory?status=AVAILABLE');

      expect(res.status).toBe(200);
      expect(prisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ Status: 'AVAILABLE' }),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      prisma.item.findMany.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app).get('/inventory');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /inventory/:id', () => {
    it('should return item by ID', async () => {
      const mockItem = { Item_ID: 1, Item_Code: 'ITM-2026-001', Brand: 'Dell', Status: 'AVAILABLE' };
      prisma.item.findUnique.mockResolvedValue(mockItem);

      const res = await request(app).get('/inventory/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockItem);
    });

    it('should return 404 for non-existent item', async () => {
      prisma.item.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/inventory/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /inventory', () => {
    it('should create an item', async () => {
      const newItem = {
        Item_Code: 'TEST-001',
        Item_Type: 'MOUSE',
        Brand: 'Logitech',
      };
      prisma.item.findFirst.mockResolvedValue(null); // No duplicate
      prisma.item.create.mockResolvedValue({ Item_ID: 3, ...newItem, Status: 'AVAILABLE' });

      const res = await request(app)
        .post('/inventory')
        .send(newItem);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should reject duplicate item code', async () => {
      prisma.item.findFirst.mockResolvedValue({ Item_ID: 1, Item_Code: 'DUPE-001' });

      const res = await request(app)
        .post('/inventory')
        .send({ Item_Code: 'DUPE-001', Item_Type: 'MOUSE' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already exists');
    });

    it('should reject missing Item_Code', async () => {
      const res = await request(app)
        .post('/inventory')
        .send({ Brand: 'Dell' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid Item_Type', async () => {
      prisma.item.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/inventory')
        .send({ Item_Code: 'TEST-002', Item_Type: 'INVALID TYPE!' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should allow a custom Item_Type', async () => {
      const newItem = {
        Item_Code: 'TEST-003',
        Item_Type: 'USB Cable',
        Brand: 'Generic',
      };
      prisma.item.findFirst.mockResolvedValue(null);
      prisma.item.create.mockResolvedValue({ Item_ID: 4, ...newItem, Item_Type: 'USB_CABLE', Status: 'AVAILABLE' });

      const res = await request(app)
        .post('/inventory')
        .send(newItem);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ Item_Type: 'USB_CABLE' }),
        })
      );
    });
  });

  describe('PUT /inventory/:id', () => {
    it('should update an existing item', async () => {
      const existingItem = { Item_ID: 1, Item_Code: 'ITM-001', Status: 'AVAILABLE' };
      const updatedItem = { ...existingItem, Status: 'BORROWED' };

      prisma.item.findUnique.mockResolvedValue(existingItem);
      prisma.item.update.mockResolvedValue(updatedItem);

      const res = await request(app)
        .put('/inventory/1')
        .send({ Status: 'BORROWED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.Status).toBe('BORROWED');
    });

    it('should return 404 for non-existent item', async () => {
      prisma.item.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/inventory/999')
        .send({ Status: 'BORROWED' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /inventory/bulk', () => {
    it('should create items with a custom Item_Type', async () => {
      prisma.item.findMany.mockResolvedValue([]);
      prisma.item.findFirst.mockResolvedValue(null);
      prisma.item.create.mockImplementation(({ data }) => Promise.resolve({ Item_ID: 5, ...data }));

      const res = await request(app)
        .post('/inventory/bulk')
        .send({
          items: [
            {
              Item_Type: 'USB Cable',
              Brand: 'Generic',
              Serial_Number: 'USB-001',
              Status: 'AVAILABLE',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const currentYear = new Date().getFullYear();
      expect(prisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Item_Code: `USB-${currentYear}-001`,
            Item_Type: 'USB_CABLE',
          }),
        })
      );
    });
  });

  describe('DELETE /inventory/:id', () => {
    it('should soft-delete an item', async () => {
      const existingItem = { Item_ID: 1, Item_Code: 'ITM-001', Status: 'AVAILABLE' };
      prisma.item.findUnique.mockResolvedValue(existingItem);
      prisma.item.update.mockResolvedValue({ ...existingItem, Status: 'DISPOSED' });

      const res = await request(app).delete('/inventory/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Item_ID: 1 },
          data: expect.objectContaining({ Status: 'DISPOSED' }),
        })
      );
    });

    it('should return 404 for non-existent item', async () => {
      prisma.item.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/inventory/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
