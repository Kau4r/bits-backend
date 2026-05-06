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
    prisma.FormAttachment,
    prisma.FormHistory,
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

    const res = await request(app).get('/api/maintenance/cleanup-preview');

    expect(res.status).toBe(200);
    expect(res.body.data.confirmationText).toBe('RESET OPERATIONAL DATA');
    expect(res.body.data.willDelete.forms).toBe(4);
    expect(res.body.data.willDelete.tickets).toBe(3);
    expect(res.body.data.willPreserve.rooms).toBe(2);
  });

  it('returns April 25 demo cleanup preview for exact target forms', async () => {
    prisma.Form.findMany.mockResolvedValue([
      {
        Form_ID: 4,
        Form_Code: 'WRF-123456',
        Title: 'Testing',
        Status: 'CANCELLED',
        Department: 'PPFO',
        Created_At: new Date('2026-04-25T06:05:39.000Z'),
        Updated_At: new Date('2026-04-25T06:08:08.000Z'),
      },
      {
        Form_ID: 5,
        Form_Code: 'WRF-456789',
        Title: 'Repair of ACU',
        Status: 'PENDING',
        Department: 'REQUESTOR',
        Created_At: new Date('2026-04-25T06:13:33.000Z'),
        Updated_At: new Date('2026-04-25T06:13:33.000Z'),
      },
      {
        Form_ID: 6,
        Form_Code: 'WRF-987456',
        Title: 'Test 2',
        Status: 'IN_REVIEW',
        Department: 'REQUESTOR',
        Created_At: new Date('2026-04-25T06:15:44.000Z'),
        Updated_At: new Date('2026-04-25T06:16:15.000Z'),
      },
    ]);
    prisma.FormHistory.count.mockResolvedValue(8);
    prisma.FormAttachment.count.mockResolvedValue(0);
    prisma.Audit_Log.findMany
      .mockResolvedValueOnce([
        { Log_ID: 63, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-123456 to REQUESTOR' },
        { Log_ID: 69, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-456789 to REQUESTOR' },
        { Log_ID: 70, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-987456 to REQUESTOR' },
      ])
      .mockResolvedValueOnce([]);
    prisma.NotificationRead.count.mockResolvedValue(5);

    const res = await request(app).get('/api/maintenance/april-25-demo-preview');

    expect(res.status).toBe(200);
    expect(res.body.data.confirmationText).toBe('REMOVE APRIL 25 DEMO DATA');
    expect(res.body.data.willDelete.forms).toBe(3);
    expect(res.body.data.willDelete.formHistory).toBe(8);
    expect(res.body.data.willDelete.notifications).toBe(3);
    expect(res.body.data.willDelete.notificationReads).toBe(5);
    expect(res.body.data.targetForms.map(form => form.formCode)).toEqual([
      'WRF-123456',
      'WRF-456789',
      'WRF-987456',
    ]);
    expect(res.body.data.canRun).toBe(true);
  });

  it('returns zero April 25 demo rows after target data is absent', async () => {
    prisma.Form.findMany.mockResolvedValue([]);
    prisma.Audit_Log.findMany.mockResolvedValue([]);
    prisma.NotificationRead.count.mockResolvedValue(0);

    const res = await request(app).get('/api/maintenance/april-25-demo-preview');

    expect(res.status).toBe(200);
    expect(res.body.data.willDelete).toEqual(expect.objectContaining({
      forms: 0,
      formHistory: 0,
      formAttachments: 0,
      notifications: 0,
      notificationReads: 0,
      auditLogs: 0,
    }));
    expect(res.body.data.missingFormCodes).toEqual([
      'WRF-123456',
      'WRF-456789',
      'WRF-987456',
    ]);
    expect(res.body.data.canRun).toBe(true);
  });

  it('rejects cleanup for non-admin users', async () => {
    mockUser = { ...mockUser, User_Role: 'LAB_HEAD' };

    const res = await request(app)
      .post('/api/maintenance/cleanup')
      .send({ confirmation: 'RESET OPERATIONAL DATA' });

    expect(res.status).toBe(403);
    expect(prisma.Form.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects cleanup with wrong confirmation text', async () => {
    const res = await request(app)
      .post('/api/maintenance/cleanup')
      .send({ confirmation: 'reset' });

    expect(res.status).toBe(400);
    expect(prisma.Form.deleteMany).not.toHaveBeenCalled();
  });

  it('clears operational records and resets operational state', async () => {
    const res = await request(app)
      .post('/api/maintenance/cleanup')
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

  it('removes only April 25 demo form data with exact confirmation text', async () => {
    prisma.Form.findMany.mockResolvedValue([
      {
        Form_ID: 4,
        Form_Code: 'WRF-123456',
        Title: 'Testing',
        Status: 'CANCELLED',
        Department: 'PPFO',
        Created_At: new Date('2026-04-25T06:05:39.000Z'),
        Updated_At: new Date('2026-04-25T06:08:08.000Z'),
      },
      {
        Form_ID: 5,
        Form_Code: 'WRF-456789',
        Title: 'Repair of ACU',
        Status: 'PENDING',
        Department: 'REQUESTOR',
        Created_At: new Date('2026-04-25T06:13:33.000Z'),
        Updated_At: new Date('2026-04-25T06:13:33.000Z'),
      },
      {
        Form_ID: 6,
        Form_Code: 'WRF-987456',
        Title: 'Test 2',
        Status: 'IN_REVIEW',
        Department: 'REQUESTOR',
        Created_At: new Date('2026-04-25T06:15:44.000Z'),
        Updated_At: new Date('2026-04-25T06:16:15.000Z'),
      },
    ]);
    prisma.FormHistory.count.mockResolvedValue(8);
    prisma.FormAttachment.count.mockResolvedValue(0);
    prisma.Audit_Log.findMany
      .mockResolvedValueOnce([
        { Log_ID: 63, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-123456 to REQUESTOR' },
        { Log_ID: 69, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-456789 to REQUESTOR' },
        { Log_ID: 70, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-987456 to REQUESTOR' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { Log_ID: 63, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-123456 to REQUESTOR' },
        { Log_ID: 69, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-456789 to REQUESTOR' },
        { Log_ID: 70, Action: 'FORM_SUBMITTED', Details: 'Submitted form WRF-987456 to REQUESTOR' },
      ])
      .mockResolvedValueOnce([]);
    prisma.NotificationRead.count.mockResolvedValue(5);
    prisma.NotificationRead.deleteMany.mockResolvedValue({ count: 5 });
    prisma.Audit_Log.deleteMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.FormAttachment.deleteMany.mockResolvedValue({ count: 0 });
    prisma.FormHistory.deleteMany.mockResolvedValue({ count: 8 });
    prisma.Form.deleteMany.mockResolvedValue({ count: 3 });

    const res = await request(app)
      .post('/api/maintenance/april-25-demo-cleanup')
      .send({ confirmation: 'REMOVE APRIL 25 DEMO DATA' });

    expect(res.status).toBe(200);
    expect(prisma.NotificationRead.deleteMany).toHaveBeenCalledWith({
      where: { Log_ID: { in: [63, 69, 70] } },
    });
    expect(prisma.Audit_Log.deleteMany).toHaveBeenCalledWith({
      where: { Log_ID: { in: [63, 69, 70] } },
    });
    expect(prisma.FormHistory.deleteMany).toHaveBeenCalledWith({
      where: { Form_ID: { in: [4, 5, 6] } },
    });
    expect(prisma.Form.deleteMany).toHaveBeenCalledWith({
      where: { Form_ID: { in: [4, 5, 6] } },
    });
    expect(prisma.Booked_Room.deleteMany).not.toHaveBeenCalled();
    expect(prisma.ticket.deleteMany).not.toHaveBeenCalled();
    expect(prisma.Borrowing_Comp.deleteMany).not.toHaveBeenCalled();
    expect(prisma.Borrow_Item.deleteMany).not.toHaveBeenCalled();
    expect(prisma.Schedule.deleteMany).not.toHaveBeenCalled();
    expect(prisma.Weekly_Report.deleteMany).not.toHaveBeenCalled();
    expect(prisma.ComputerHeartbeat.deleteMany).not.toHaveBeenCalled();
    expect(prisma.Room.updateMany).not.toHaveBeenCalled();
    expect(prisma.Computer.updateMany).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
    expect(prisma.User.delete).not.toHaveBeenCalled();
    expect(prisma.Audit_Log.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ Action: 'APRIL_25_DEMO_CLEANUP' }),
    }));
  });

  it('allows April 25 demo cleanup to run idempotently when target rows are gone', async () => {
    prisma.Form.findMany.mockResolvedValue([]);
    prisma.Audit_Log.findMany.mockResolvedValue([]);
    prisma.NotificationRead.count.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/maintenance/april-25-demo-cleanup')
      .send({ confirmation: 'REMOVE APRIL 25 DEMO DATA' });

    expect(res.status).toBe(200);
    expect(res.body.data.before.willDelete.forms).toBe(0);
    expect(res.body.data.result.deleted.forms).toBe(0);
    expect(prisma.NotificationRead.deleteMany).toHaveBeenCalledWith({
      where: { Log_ID: { in: [] } },
    });
    expect(prisma.Form.deleteMany).toHaveBeenCalledWith({
      where: { Form_ID: { in: [] } },
    });
    expect(prisma.Booked_Room.deleteMany).not.toHaveBeenCalled();
  });
});
