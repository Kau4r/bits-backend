const request = require('supertest');
const bcrypt = require('bcrypt');
const prisma = require('../__mocks__/prisma');

// Mock the auth middleware - keep authenticateToken for login (not used), but needed for logout
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

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials (bcrypt password)', async () => {
      const hashedPassword = await bcrypt.hash('correct-password', 10);
      const mockUser = {
        User_ID: 1,
        Email: 'test@example.com',
        First_Name: 'John',
        Last_Name: 'Doe',
        User_Role: 'ADMIN',
        Password: hashedPassword,
        Is_Active: true,
      };
      prisma.user.findFirst.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'test@example.com', password: 'correct-password' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user).not.toHaveProperty('Password');
    });

    it('should login with valid credentials (plain text legacy password)', async () => {
      const mockUser = {
        User_ID: 2,
        Email: 'legacy@example.com',
        First_Name: 'Legacy',
        Last_Name: 'User',
        User_Role: 'STUDENT',
        Password: 'plain-text-pass',
        Is_Active: true,
      };
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser); // For password migration

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'legacy@example.com', password: 'plain-text-pass' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
    });

    it('should reject invalid password', async () => {
      const hashedPassword = await bcrypt.hash('correct-password', 10);
      const mockUser = {
        User_ID: 1,
        Email: 'test@example.com',
        Password: hashedPassword,
        Is_Active: true,
      };
      prisma.user.findFirst.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid');
    });

    it('should reject non-existent user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'password' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject deactivated user', async () => {
      const hashedPassword = await bcrypt.hash('password', 10);
      prisma.user.findFirst.mockResolvedValue({
        User_ID: 3,
        Email: 'inactive@example.com',
        Password: hashedPassword,
        Is_Active: false,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'inactive@example.com', password: 'password' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('deactivated');
    });

    it('should reject missing username/email', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: 'password' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty body', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully', async () => {
      const res = await request(app)
        .post('/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
