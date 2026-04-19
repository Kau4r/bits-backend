const request = require('supertest');
const prisma = require('../__mocks__/prisma');

let mockUser;

jest.mock('../../src/middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = mockUser;
    next();
  },
  JWT_SECRET: 'test-secret',
}));

jest.mock('../../src/services/notificationManager', () => ({
  add: jest.fn(),
  remove: jest.fn(),
  send: jest.fn(),
  broadcastBookingEvent: jest.fn().mockResolvedValue(undefined),
  clients: new Map(),
}));

const { app } = require('../app');

const mockCountDelegates = () => {
  [
    prisma.Form,
    prisma.FormAttachment,
    prisma.FormHistory,
    prisma.ticket,
    prisma.Booked_Room,
    prisma.Schedule,
    prisma.Borrow_Item,
    prisma.Borrowing_Comp,
    prisma.Audit_Log,
    prisma.NotificationRead,
    prisma.Weekly_Report,
    prisma.ComputerHeartbeat,
    prisma.Room,
    prisma.Computer,
    prisma.item,
    prisma.User,
  ].forEach(delegate => delegate?.count?.mockResolvedValue(0));
};

const mockCleanupMutations = () => {
  [
    prisma.NotificationRead,
    prisma.Audit_Log,
    prisma.Form,
    prisma.ticket,
    prisma.Borrowing_Comp,
    prisma.Borrow_Item,
    prisma.Booked_Room,
    prisma.Schedule,
    prisma.ComputerHeartbeat,
    prisma.Weekly_Report,
  ].forEach(delegate => delegate?.deleteMany?.mockResolvedValue({ count: 0 }));

  prisma.Room.updateMany.mockResolvedValue({ count: 2 });
  prisma.Computer.updateMany.mockResolvedValue({ count: 3 });
  prisma.item.updateMany.mockResolvedValue({ count: 1 });
  prisma.Audit_Log.create.mockResolvedValue({ Log_ID: 1 });
};

describe('Maintenance Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      User_ID: 1,
      Email: 'admin@test.com',
      First_Name: 'System',
      Last_Name: 'Admin',
      User_Role: 'ADMIN',
      Is_Active: true,
    };
    mockCountDelegates();
    mockCleanupMutations();
  });

  it('returns cleanup preview for admins', async () => {
    prisma.Form.count.mockResolvedValue(4);
    prisma.ticket.count.mockResolvedValue(3);
    prisma.Room.count.mockResolvedValue(2);

    const res = await request(app).get('/maintenance/cleanup-preview');

    expect(res.status).toBe(200);
    expect(res.body.data.confirmationText).toBe('RESET OPERATIONAL DATA');
    expect(res.body.data.willDelete.forms).toBe(4);
    expect(res.body.data.willDelete.tickets).toBe(3);
    expect(res.body.data.willPreserve.rooms).toBe(2);
  });

  it('rejects cleanup for non-admin users', async () => {
    mockUser = { ...mockUser, User_Role: 'LAB_HEAD' };

    const res = await request(app)
      .post('/maintenance/cleanup')
      .send({ confirmation: 'RESET OPERATIONAL DATA' });

    expect(res.status).toBe(403);
    expect(prisma.Form.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects cleanup with wrong confirmation text', async () => {
    const res = await request(app)
      .post('/maintenance/cleanup')
      .send({ confirmation: 'reset' });

    expect(res.status).toBe(400);
    expect(prisma.Form.deleteMany).not.toHaveBeenCalled();
  });

  it('clears operational records and resets operational state', async () => {
    const res = await request(app)
      .post('/maintenance/cleanup')
      .send({ confirmation: 'RESET OPERATIONAL DATA' });

    expect(res.status).toBe(200);
    expect(prisma.NotificationRead.deleteMany).toHaveBeenCalled();
    expect(prisma.Audit_Log.deleteMany).toHaveBeenCalled();
    expect(prisma.Form.deleteMany).toHaveBeenCalled();
    expect(prisma.Booked_Room.deleteMany).toHaveBeenCalled();
    expect(prisma.Schedule.deleteMany).toHaveBeenCalled();
    expect(prisma.Room.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ Status: 'AVAILABLE' }),
    }));
    expect(prisma.Computer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ Status: 'AVAILABLE', Is_Online: false }),
    }));
    expect(prisma.item.updateMany).toHaveBeenCalledWith({
      where: { Status: 'BORROWED' },
      data: { Status: 'AVAILABLE' },
    });
    expect(prisma.Audit_Log.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ Action: 'DATABASE_CLEANUP' }),
    }));
  });
});
