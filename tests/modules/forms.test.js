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

jest.mock('../../src/utils/auditLogger', () => ({
  logForm: jest.fn().mockResolvedValue({}),
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

const AuditLogger = require('../../src/utils/auditLogger');
const { app } = require('../app');

const year = new Date().getFullYear();

const createdForm = (overrides = {}) => ({
  Form_ID: 1,
  Form_Code: `WRF-${year}-001`,
  Creator_ID: 9999,
  Form_Type: 'WRF',
  Department: 'REQUESTOR',
  File_Name: 'wrf.pdf',
  File_URL: 'https://example.test/uploads/wrf.pdf',
  File_Type: 'application/pdf',
  Requester_Name: 'Juan Dela Cruz',
  Remarks: 'Need replacement keyboard',
  History: [{ Department: 'REQUESTOR', Notes: 'Form created' }],
  ...overrides,
});

describe('Form Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      User_ID: 9999,
      Email: 'labhead@test.com',
      First_Name: 'Lab',
      Last_Name: 'Head',
      User_Role: 'LAB_HEAD',
      Is_Active: true,
    };
  });

  describe('POST /forms', () => {
    it('creates a WRF form with REQUESTOR department, file fields, requester name, remarks, and initial history', async () => {
      const form = createdForm();
      prisma.Form.count.mockResolvedValue(0);
      prisma.Form.create.mockResolvedValue({ ...form, Creator: { User_ID: 9999 } });
      prisma.FormHistory.create.mockResolvedValue({ History_ID: 1 });
      prisma.Form.findUnique.mockResolvedValue(form);

      const res = await request(app)
        .post('/forms')
        .send({
          creatorId: 9999,
          formType: 'WRF',
          title: 'WRF request',
          content: 'REQUESTOR',
          fileName: 'wrf.pdf',
          fileUrl: 'https://example.test/uploads/wrf.pdf',
          fileType: 'application/pdf',
          department: 'REQUESTOR',
          requesterName: 'Juan Dela Cruz',
          remarks: 'Need replacement keyboard',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.Form_Code).toBe(`WRF-${year}-001`);
      expect(prisma.Form.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Form_Code: `WRF-${year}-001`,
            Form_Type: 'WRF',
            Department: 'REQUESTOR',
            File_Name: 'wrf.pdf',
            File_URL: 'https://example.test/uploads/wrf.pdf',
            File_Type: 'application/pdf',
            Requester_Name: 'Juan Dela Cruz',
            Remarks: 'Need replacement keyboard',
          }),
        })
      );
      expect(prisma.FormHistory.create).toHaveBeenCalledWith({
        data: {
          Form_ID: 1,
          Department: 'REQUESTOR',
          Notes: 'Form created',
        },
      });
      expect(AuditLogger.logForm).toHaveBeenCalledWith(
        9999,
        'FORM_SUBMITTED',
        `Submitted form WRF-${year}-001 to REQUESTOR`,
        ['LAB_TECH', 'LAB_HEAD']
      );
    });

    it('creates an RIS form with PURCHASING department', async () => {
      const form = createdForm({
        Form_Code: `RIS-${year}-001`,
        Form_Type: 'RIS',
        Department: 'PURCHASING',
      });
      prisma.Form.count.mockResolvedValue(0);
      prisma.Form.create.mockResolvedValue({ ...form, Creator: { User_ID: 9999 } });
      prisma.FormHistory.create.mockResolvedValue({ History_ID: 2 });
      prisma.Form.findUnique.mockResolvedValue(form);

      const res = await request(app)
        .post('/forms')
        .send({
          creatorId: 9999,
          formType: 'RIS',
          fileName: 'ris.pdf',
          fileUrl: 'https://example.test/uploads/ris.pdf',
          fileType: 'application/pdf',
          department: 'PURCHASING',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.Form_Code).toBe(`RIS-${year}-001`);
      expect(prisma.Form.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Form_Type: 'RIS',
            Department: 'PURCHASING',
          }),
        })
      );
    });
  });

  describe('POST /forms/:id/transfer', () => {
    it('transfers a WRF form to PPFO after Department Head has been visited', async () => {
      const existingForm = createdForm({
        Department: 'DEPARTMENT_HEAD',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Send to Department Head' },
        ],
      });
      const form = createdForm({
        Department: 'PPFO',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Send to Department Head' },
          { Department: 'PPFO', Notes: 'Send to PPFO' },
        ],
      });
      prisma.Form.findUnique.mockResolvedValue(existingForm);
      prisma.Form.update.mockResolvedValue(form);

      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'PPFO', notes: 'Send to PPFO' });

      expect(res.status).toBe(200);
      expect(res.body.data.Department).toBe('PPFO');
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: {
            Department: 'PPFO',
            History: {
              create: {
                Department: 'PPFO',
                Notes: 'Send to PPFO',
              },
            },
          },
        })
      );
    });

    it('rejects a skipped WRF transfer when the previous workflow step has not been visited', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Department: 'REQUESTOR',
        History: [{ Department: 'REQUESTOR', Notes: 'Form created' }],
      }));

      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'PPFO', notes: 'Skip Department Head' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot transfer to PPFO before visiting DEPARTMENT_HEAD');
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('rejects a department that does not belong to the form type workflow', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Form_Type: 'WRF',
        Department: 'DEPARTMENT_HEAD',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Send to Department Head' },
        ],
      }));

      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'PURCHASING' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid department for WRF form');
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('rejects a legacy LABORATORY department with 400 instead of calling Prisma', async () => {
      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'LABORATORY' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid department');
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /forms', () => {
    it('rejects an invalid legacy department filter before calling Prisma', async () => {
      const res = await request(app).get('/forms?department=LABORATORY');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid department');
      expect(prisma.Form.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /dashboard', () => {
    it('counts pending forms without filtering by the removed LABORATORY department', async () => {
      mockUser = {
        ...mockUser,
        User_Role: 'LAB_TECH',
      };

      prisma.ticket.count.mockResolvedValue(0);
      prisma.borrow_Item.count.mockResolvedValue(0);
      prisma.form.count.mockResolvedValue(3);
      prisma.audit_Log.findMany.mockResolvedValue([]);

      const res = await request(app).get('/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.data.counts.pendingForms).toBe(3);
      expect(prisma.form.count).toHaveBeenCalledWith({
        where: {
          Status: 'PENDING',
          Is_Archived: false,
        },
      });
    });
  });
});
