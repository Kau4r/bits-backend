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

describe('Users Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /users/me', () => {
    it('should return the authenticated user', async () => {
      const res = await request(app).get('/users/me');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.User_ID).toBe(9999);
      expect(res.body.data.Email).toBe('admin@test.com');
      expect(res.body.data.User_Role).toBe('ADMIN');
    });
  });

  describe('GET /users', () => {
    it('should return all users', async () => {
      const mockUsers = [
        { User_ID: 1, First_Name: 'John', Last_Name: 'Doe', Email: 'john@test.com', User_Role: 'ADMIN', Is_Active: true },
        { User_ID: 2, First_Name: 'Jane', Last_Name: 'Smith', Email: 'jane@test.com', User_Role: 'STUDENT', Is_Active: true },
      ];
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const res = await request(app).get('/users');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('should filter by active status', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const res = await request(app).get('/users?active=true');

      expect(res.status).toBe(200);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ Is_Active: true }),
        })
      );
    });

    it('should filter by role', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const res = await request(app).get('/users?role=ADMIN');

      expect(res.status).toBe(200);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ User_Role: 'ADMIN' }),
        })
      );
    });

    it('should handle database errors', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/users');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /users', () => {
    it('should create a new user', async () => {
      const newUser = {
        User_Role: 'STUDENT',
        First_Name: 'New',
        Last_Name: 'User',
        Email: 'new@test.com',
        Password: 'securepassword',
      };
      prisma.User.findFirst.mockResolvedValue(null); // No duplicate email
      prisma.User.create.mockResolvedValue({
        User_ID: 10,
        ...newUser,
        Is_Active: true,
        Created_At: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/users')
        .send(newUser);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).not.toHaveProperty('Password');
    });

    it('should reject duplicate email', async () => {
      prisma.User.findFirst.mockResolvedValue({ User_ID: 1, Email: 'existing@test.com' });

      const res = await request(app)
        .post('/users')
        .send({
          User_Role: 'STUDENT',
          First_Name: 'Dup',
          Last_Name: 'User',
          Email: 'existing@test.com',
          Password: 'password',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('already exists');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/users')
        .send({ First_Name: 'Incomplete' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /users/:id', () => {
    it('should update user data', async () => {
      const existingUser = {
        User_ID: 1,
        First_Name: 'John',
        Last_Name: 'Doe',
        Email: 'john@test.com',
        Password: 'hashedpass',
        User_Role: 'STUDENT',
        Is_Active: true,
      };
      const updatedUser = { ...existingUser, First_Name: 'Johnny' };

      prisma.User.findUnique.mockResolvedValue(existingUser);
      prisma.User.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .put('/users/1')
        .send({ First_Name: 'Johnny' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.First_Name).toBe('Johnny');
      expect(res.body.data).not.toHaveProperty('Password');
    });

    it('should return 404 for non-existent user', async () => {
      prisma.User.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/users/999')
        .send({ First_Name: 'Nobody' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /users/:id', () => {
    it('should soft-delete (deactivate) a user', async () => {
      const activeUser = {
        User_ID: 1,
        First_Name: 'John',
        Last_Name: 'Doe',
        Email: 'john@test.com',
        Password: 'hashedpass',
        Is_Active: true,
      };
      prisma.User.findFirst.mockResolvedValue(activeUser);
      prisma.User.update.mockResolvedValue({ ...activeUser, Is_Active: false });
      prisma.Audit_Log.create.mockResolvedValue({});

      const res = await request(app).delete('/users/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('inactive');
    });

    it('should return 404 for non-existent or already inactive user', async () => {
      prisma.User.findFirst.mockResolvedValue(null);

      const res = await request(app).delete('/users/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
