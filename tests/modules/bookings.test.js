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

describe('Bookings Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /bookings', () => {
    it('should return all bookings', async () => {
      const mockBookings = [
        {
          Booked_Room_ID: 1,
          User_ID: 1,
          Room_ID: 1,
          Status: 'PENDING',
          Start_Time: '2026-03-20T08:00:00.000Z',
          End_Time: '2026-03-20T10:00:00.000Z',
          Room: { Room_ID: 1, Name: 'Lab A' },
          User: { First_Name: 'John', Last_Name: 'Doe', Email: 'john@test.com' },
          Approver: null,
        },
      ];
      prisma.Booked_Room.findMany.mockResolvedValue(mockBookings);

      const res = await request(app).get('/bookings');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockBookings);
    });

    it('should filter by status', async () => {
      prisma.Booked_Room.findMany.mockResolvedValue([]);

      const res = await request(app).get('/bookings?status=APPROVED');

      expect(res.status).toBe(200);
      expect(prisma.Booked_Room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ Status: 'APPROVED' }),
        })
      );
    });

    it('should filter by roomId', async () => {
      prisma.Booked_Room.findMany.mockResolvedValue([]);

      const res = await request(app).get('/bookings?roomId=1');

      expect(res.status).toBe(200);
      expect(prisma.Booked_Room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ Room_ID: 1 }),
        })
      );
    });

    it('should handle database errors', async () => {
      prisma.Booked_Room.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/bookings');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /bookings', () => {
    const validBooking = {
      User_ID: 1,
      Room_ID: 1,
      Start_Time: '2026-03-18T08:00:00.000Z', // Wednesday
      End_Time: '2026-03-18T10:00:00.000Z',
      Purpose: 'Lab session',
    };

    it('should create a booking successfully', async () => {
      const mockRoom = {
        Room_ID: 1,
        Name: 'Lab A',
        Status: 'AVAILABLE',
        Schedule: [],
      };
      const mockCreatedBooking = {
        Booked_Room_ID: 1,
        ...validBooking,
        Status: 'PENDING',
        Room: mockRoom,
        User: { User_ID: 1, First_Name: 'John', Last_Name: 'Doe', Email: 'john@test.com' },
        Approver: null,
      };

      prisma.room.findUnique.mockResolvedValue(mockRoom);
      prisma.user.findUnique.mockResolvedValue({ User_ID: 1, User_Role: 'FACULTY' });
      prisma.Booked_Room.findFirst.mockResolvedValue(null); // No conflicts
      prisma.Booked_Room.create.mockResolvedValue(mockCreatedBooking);

      const res = await request(app)
        .post('/bookings')
        .send(validBooking);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.Status).toBe('PENDING');
    });

    it('should reject booking with missing required fields', async () => {
      const res = await request(app)
        .post('/bookings')
        .send({ Room_ID: 1 }); // Missing User_ID, Start_Time, End_Time

      expect(res.status).toBe(400);
    });

    it('should reject booking on a Sunday', async () => {
      // 2026-03-22 is a Sunday
      const sundayBooking = {
        User_ID: 1,
        Room_ID: 1,
        Start_Time: '2026-03-22T08:00:00.000Z',
        End_Time: '2026-03-22T10:00:00.000Z',
      };

      const res = await request(app)
        .post('/bookings')
        .send(sundayBooking);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Sunday');
    });

    it('should reject booking for non-existent room', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/bookings')
        .send(validBooking);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject booking for unavailable room', async () => {
      prisma.room.findUnique.mockResolvedValue({
        Room_ID: 1,
        Name: 'Lab A',
        Status: 'MAINTENANCE',
        Schedule: [],
      });
      prisma.user.findUnique.mockResolvedValue({ User_ID: 1, User_Role: 'FACULTY' });

      const res = await request(app)
        .post('/bookings')
        .send(validBooking);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject booking with conflicting time slot', async () => {
      prisma.room.findUnique.mockResolvedValue({
        Room_ID: 1,
        Name: 'Lab A',
        Status: 'AVAILABLE',
        Schedule: [],
      });
      prisma.user.findUnique.mockResolvedValue({ User_ID: 1, User_Role: 'FACULTY' });
      prisma.Booked_Room.findFirst.mockResolvedValue({
        Booked_Room_ID: 2,
        Status: 'APPROVED',
        Start_Time: '2026-03-18T09:00:00.000Z',
        End_Time: '2026-03-18T11:00:00.000Z',
        User: { First_Name: 'Jane', Last_Name: 'Doe' },
      });

      const res = await request(app)
        .post('/bookings')
        .send(validBooking);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('auto-approves secretary conference bookings and rejects overlapping pending bookings', async () => {
      const conferenceBooking = {
        User_ID: 5,
        Room_ID: 9,
        Start_Time: '2026-03-18T08:00:00.000Z',
        End_Time: '2026-03-18T10:00:00.000Z',
        Purpose: 'Conference',
      };
      const conferenceRoom = {
        Room_ID: 9,
        Name: 'Conference Room',
        Room_Type: 'CONFERENCE',
        Status: 'AVAILABLE',
        Schedule: [],
      };
      const pendingBooking = {
        Booked_Room_ID: 3,
        User_ID: 8,
        Room_ID: 9,
        Status: 'PENDING',
        Start_Time: '2026-03-18T08:30:00.000Z',
        End_Time: '2026-03-18T09:30:00.000Z',
        Notes: null,
        Room: conferenceRoom,
        User: { User_ID: 8, First_Name: 'Faculty', Last_Name: 'User', Email: 'faculty@test.com' },
        Approver: null,
      };
      const createdBooking = {
        Booked_Room_ID: 4,
        ...conferenceBooking,
        Status: 'APPROVED',
        Approved_By: 5,
        Room: conferenceRoom,
        User: { User_ID: 5, First_Name: 'School', Last_Name: 'Secretary', Email: 'sec@test.com' },
        Approver: { User_ID: 5, First_Name: 'School', Last_Name: 'Secretary', User_Role: 'SECRETARY' },
      };

      prisma.room.findUnique.mockResolvedValue(conferenceRoom);
      prisma.user.findUnique.mockResolvedValue({ User_ID: 5, User_Role: 'SECRETARY' });
      prisma.Booked_Room.findFirst.mockResolvedValue(null);
      prisma.Booked_Room.findMany.mockResolvedValue([pendingBooking]);
      prisma.Booked_Room.update.mockResolvedValue({ ...pendingBooking, Status: 'REJECTED' });
      prisma.Booked_Room.create.mockResolvedValue(createdBooking);

      const res = await request(app)
        .post('/bookings')
        .send(conferenceBooking);

      expect(res.status).toBe(201);
      expect(res.body.data.Status).toBe('APPROVED');
      expect(res.body.meta.rejectedBookings).toBe(1);
      expect(prisma.Booked_Room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Booked_Room_ID: 3 },
          data: expect.objectContaining({ Status: 'REJECTED' }),
        })
      );
      expect(prisma.Booked_Room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Status: 'APPROVED',
            Approved_By: 5,
          }),
        })
      );
    });
  });

  describe('DELETE /bookings/:id', () => {
    it('should delete a booking as owner', async () => {
      prisma.Booked_Room.findUnique.mockResolvedValue({
        Booked_Room_ID: 1,
        User_ID: 9999, // Same as mock auth user
        Room: { Name: 'Lab A' },
        User: { First_Name: 'Test', Last_Name: 'Admin' },
      });
      prisma.Booked_Room.delete.mockResolvedValue({});

      const res = await request(app).delete('/bookings/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent booking', async () => {
      prisma.Booked_Room.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/bookings/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
