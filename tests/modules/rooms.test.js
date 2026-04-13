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
}));

jest.mock('../../src/utils/auditLogger', () => ({
  log: jest.fn().mockResolvedValue({ Log_ID: 1 }),
  logBooking: jest.fn().mockResolvedValue({ Log_ID: 2 }),
}));

jest.mock('../../src/services/notificationManager', () => ({
  send: jest.fn(),
  broadcastBookingEvent: jest.fn().mockResolvedValue(undefined),
}));

const NotificationManager = require('../../src/services/notificationManager');
const { app } = require('../app');

describe('Room Queue Availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const requestBody = {
    startTime: '2026-04-13T10:00:00.000Z',
    endTime: '2026-04-13T15:00:00.000Z',
    notes: 'Computer use queue',
  };

  const labRoom = {
    Room_ID: 1,
    Name: 'LB 445',
    Room_Type: 'LAB',
    Status: 'AVAILABLE',
    Schedule: [],
  };

  it('blocks computer use queue when an approved booking overlaps', async () => {
    prisma.Room.findUnique.mockResolvedValue(labRoom);
    prisma.Booked_Room.findFirst.mockResolvedValue({
      Booked_Room_ID: 10,
      Room_ID: 1,
      Status: 'APPROVED',
      Start_Time: new Date('2026-04-13T10:00:00.000Z'),
      End_Time: new Date('2026-04-13T15:00:00.000Z'),
    });

    const res = await request(app)
      .post('/rooms/1/student-availability')
      .send(requestBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('approved booking');
    expect(prisma.Booked_Room.create).not.toHaveBeenCalled();
    expect(prisma.Booked_Room.update).not.toHaveBeenCalled();
  });

  it('auto-rejects overlapping pending bookings and creates the computer use queue', async () => {
    const pendingBooking = {
      Booked_Room_ID: 11,
      Room_ID: 1,
      User_ID: 7,
      Status: 'PENDING',
      Start_Time: new Date('2026-04-13T10:00:00.000Z'),
      End_Time: new Date('2026-04-13T15:00:00.000Z'),
      Notes: null,
      User: {
        User_ID: 7,
        First_Name: 'Faculty',
        Last_Name: 'Member',
        Email: 'faculty@test.com',
      },
    };

    const createdQueueBooking = {
      Booked_Room_ID: 12,
      Room_ID: 1,
      User_ID: 9999,
      Status: 'APPROVED',
      Purpose: 'Student Usage',
      Start_Time: new Date(requestBody.startTime),
      End_Time: new Date(requestBody.endTime),
    };

    prisma.Room.findUnique.mockResolvedValue(labRoom);
    prisma.Booked_Room.findFirst.mockResolvedValue(null);
    prisma.Booked_Room.findMany.mockResolvedValue([pendingBooking]);
    prisma.Booked_Room.update.mockResolvedValue({ ...pendingBooking, Status: 'REJECTED' });
    prisma.Booked_Room.create.mockResolvedValue(createdQueueBooking);

    const res = await request(app)
      .post('/rooms/1/student-availability')
      .send(requestBody);

    expect(res.status).toBe(201);
    expect(prisma.Booked_Room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { Booked_Room_ID: 11 },
        data: expect.objectContaining({
          Status: 'REJECTED',
          Notes: expect.stringContaining('computer use queue'),
        }),
      })
    );
    expect(prisma.Booked_Room.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Room_ID: 1,
          Status: 'APPROVED',
          Purpose: 'Student Usage',
        }),
      })
    );
    expect(NotificationManager.send).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'BOOKING_REJECTED' })
    );
  });
});
