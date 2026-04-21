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
  Status: 'PENDING',
  Department: 'REQUESTOR',
  Is_Archived: false,
  File_Name: 'wrf.pdf',
  File_URL: 'https://example.test/uploads/wrf.pdf',
  File_Type: 'application/pdf',
  Requester_Name: 'Juan Dela Cruz',
  Remarks: 'Need replacement keyboard',
  Created_At: '2026-04-01T00:00:00.000Z',
  Updated_At: '2026-04-01T00:00:00.000Z',
  History: [{ Department: 'REQUESTOR', Notes: 'Form created' }],
  Attachments: [{
    Attachment_ID: 1,
    Form_ID: 1,
    Department: 'REQUESTOR',
    Document_Type: 'INITIAL',
    File_Name: 'wrf.pdf',
    File_URL: 'https://example.test/uploads/wrf.pdf',
    File_Type: 'application/pdf',
    Uploaded_By: 9999,
    Uploaded_At: new Date().toISOString(),
    Notes: 'Initial form attachment',
  }],
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
            Attachments: {
              create: [{
                Department: 'REQUESTOR',
                Document_Type: 'INITIAL',
                File_Name: 'wrf.pdf',
                File_URL: 'https://example.test/uploads/wrf.pdf',
                File_Type: 'application/pdf',
                Uploaded_By: 9999,
                Notes: 'Initial form attachment',
              }],
            },
          }),
        })
      );
      expect(prisma.FormHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          Form_ID: 1,
          Department: 'REQUESTOR',
          Notes: 'Form created',
          Performed_By: 9999,
          Action: 'CREATED',
        }),
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
        Status: 'APPROVED',
        Department: 'DEPARTMENT_HEAD',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Send to Department Head' },
        ],
        Attachments: [
          {
            Attachment_ID: 2,
            Form_ID: 1,
            Department: 'DEPARTMENT_HEAD',
            Document_Type: 'PROOF',
            File_Name: 'department-head-proof.pdf',
            File_URL: 'https://example.test/uploads/department-head-proof.pdf',
            File_Type: 'application/pdf',
            Uploaded_By: 9999,
            Uploaded_At: '2026-04-01T01:00:00.000Z',
            Notes: 'Department Head proof',
          },
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
          data: expect.objectContaining({
            Department: 'PPFO',
            Status: 'PENDING',
            Is_Archived: false,
            History: expect.objectContaining({
              create: expect.objectContaining({
                Department: 'PPFO',
                Notes: 'Send to PPFO',
                Performed_By: 9999,
                Action: 'TRANSFERRED',
              }),
            }),
          }),
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

    it('blocks RIS completion when required procurement files or received indicator are missing', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Form_Type: 'RIS',
        Status: 'APPROVED',
        Department: 'PURCHASING',
        Is_Received: false,
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Department Head' },
          { Department: 'DEAN_OFFICE', Notes: 'Dean Office' },
          { Department: 'TNS', Notes: 'TNS' },
          { Department: 'PURCHASING', Notes: 'Purchasing' },
        ],
        Attachments: [{
          Attachment_ID: 9,
          Form_ID: 1,
          Department: 'PURCHASING',
          Document_Type: 'PROOF',
          File_Name: 'purchasing-proof.pdf',
          File_URL: 'https://example.test/uploads/purchasing-proof.pdf',
          File_Type: 'application/pdf',
          Uploaded_By: 9999,
          Uploaded_At: '2026-04-01T01:00:00.000Z',
          Notes: 'Purchasing proof',
        }],
      }));

      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'COMPLETED' });

      expect(res.status).toBe(400);
      expect(res.body.missingDocumentTypes).toEqual([
        'PURCHASE_ORDER',
        'DELIVERY_RECEIPT',
        'RECEIVING_REPORT',
        'SALES_INVOICE',
      ]);
      expect(res.body.isReceived).toBe(false);
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('allows RIS completion after required files are uploaded and received is checked', async () => {
      const requiredAttachments = [
        'PURCHASE_ORDER',
        'DELIVERY_RECEIPT',
        'RECEIVING_REPORT',
        'SALES_INVOICE',
      ].map((Document_Type, index) => ({
        Attachment_ID: index + 1,
        Form_ID: 1,
        Department: 'PURCHASING',
        Document_Type,
        File_Name: `${Document_Type}.pdf`,
        File_URL: `https://example.test/uploads/${Document_Type}.pdf`,
        Uploaded_By: 9999,
        Uploaded_At: new Date().toISOString(),
      }));

      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Form_Type: 'RIS',
        Status: 'APPROVED',
        Department: 'PURCHASING',
        Is_Received: true,
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Department Head' },
          { Department: 'DEAN_OFFICE', Notes: 'Dean Office' },
          { Department: 'TNS', Notes: 'TNS' },
          { Department: 'PURCHASING', Notes: 'Purchasing' },
        ],
        Attachments: requiredAttachments,
      }));
      prisma.Form.update.mockResolvedValue(createdForm({
        Form_Type: 'RIS',
        Department: 'COMPLETED',
        Is_Received: true,
        Attachments: requiredAttachments,
      }));

      const res = await request(app)
        .post('/forms/1/transfer')
        .send({ department: 'COMPLETED', notes: 'Complete RIS' });

      expect(res.status).toBe(200);
      expect(res.body.data.Department).toBe('COMPLETED');
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: expect.objectContaining({
            Department: 'COMPLETED',
            Status: 'PENDING',
            Is_Archived: false,
            History: expect.objectContaining({
              create: expect.objectContaining({
                Department: 'COMPLETED',
                Notes: 'Complete RIS',
                Performed_By: 9999,
                Action: 'TRANSFERRED',
              }),
            }),
          }),
        })
      );
    });
  });

  describe('PATCH /forms/:id', () => {
    it('rejects ARCHIVED in the normal status update path', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm());

      const res = await request(app)
        .patch('/forms/1')
        .send({ status: 'ARCHIVED' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Use the archive endpoint to archive forms');
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('blocks approval until the current step has an attachment', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Attachments: [],
      }));

      const res = await request(app)
        .patch('/forms/1')
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(400);
      expect(res.body.requiresUpload).toBe(true);
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('approves a form when the current step has an attachment', async () => {
      const approvedForm = createdForm({ Status: 'APPROVED' });
      prisma.Form.findUnique.mockResolvedValue(createdForm());
      prisma.Form.update.mockResolvedValue(approvedForm);

      const res = await request(app)
        .patch('/forms/1')
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(200);
      expect(res.body.data.Status).toBe('APPROVED');
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: expect.objectContaining({
            Status: 'APPROVED',
            Is_Archived: false,
          }),
        })
      );
      expect(prisma.FormHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Action: 'APPROVED',
          }),
        })
      );
    });

    it('cancels a form without archiving it automatically', async () => {
      const cancelledForm = createdForm({ Status: 'CANCELLED', Is_Archived: false });
      prisma.Form.findUnique.mockResolvedValue(createdForm());
      prisma.Form.update.mockResolvedValue(cancelledForm);

      const res = await request(app)
        .patch('/forms/1')
        .send({ status: 'CANCELLED' });

      expect(res.status).toBe(200);
      expect(res.body.data.Status).toBe('CANCELLED');
      expect(res.body.data.Is_Archived).toBe(false);
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: expect.objectContaining({
            Status: 'CANCELLED',
            Is_Archived: false,
          }),
        })
      );
      expect(prisma.FormHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Action: 'CANCELLED',
          }),
        })
      );
      expect(AuditLogger.logForm).toHaveBeenCalledWith(
        9999,
        'FORM_CANCELLED',
        `Form WRF-${year}-001 cancelled`,
        ['LAB_TECH', 'LAB_HEAD'],
        9999
      );
    });
  });

  describe('PATCH /forms/:id/archive', () => {
    it('archives a completed form through the archive endpoint', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Department: 'COMPLETED',
      }));
      prisma.Form.update.mockResolvedValue(createdForm({
        Status: 'ARCHIVED',
        Is_Archived: true,
      }));

      const res = await request(app)
        .patch('/forms/1/archive')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.Status).toBe('ARCHIVED');
      expect(res.body.data.Is_Archived).toBe(true);
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: expect.objectContaining({
            Status: 'ARCHIVED',
            Is_Archived: true,
          }),
        })
      );
    });
  });

  describe('POST /forms/:id/attachments', () => {
    it('adds a proof attachment to the current form department', async () => {
      const existingForm = createdForm({
        Department: 'PPFO',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Send to Department Head' },
          { Department: 'PPFO', Notes: 'Send to PPFO' },
        ],
      });
      const updatedForm = createdForm({
        Department: 'PPFO',
        Attachments: [
          ...existingForm.Attachments,
          {
            Attachment_ID: 2,
            Form_ID: 1,
            Department: 'PPFO',
            File_Name: 'ppfo-proof.pdf',
            File_URL: 'https://example.test/uploads/ppfo-proof.pdf',
            File_Type: 'application/pdf',
            Uploaded_By: 9999,
            Uploaded_At: new Date().toISOString(),
            Notes: 'Proof from PPFO',
          },
        ],
      });
      prisma.Form.findUnique.mockResolvedValue(existingForm);
      prisma.Form.update.mockResolvedValue(updatedForm);

      const res = await request(app)
        .post('/forms/1/attachments')
        .send({
          fileName: 'ppfo-proof.pdf',
          fileUrl: 'https://example.test/uploads/ppfo-proof.pdf',
          fileType: 'application/pdf',
          notes: 'Proof from PPFO',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.Attachments).toHaveLength(2);
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: {
            Attachments: {
              create: [{
                Department: 'PPFO',
                Document_Type: 'PROOF',
                File_Name: 'ppfo-proof.pdf',
                File_URL: 'https://example.test/uploads/ppfo-proof.pdf',
                File_Type: 'application/pdf',
                Uploaded_By: 9999,
                Notes: 'Proof from PPFO',
              }],
            },
          },
        })
      );
      expect(AuditLogger.logForm).toHaveBeenCalledWith(
        9999,
        'FORM_ATTACHMENT_ADDED',
        `Added 1 attachment(s) to form WRF-${year}-001`,
        ['LAB_TECH', 'LAB_HEAD'],
        9999
      );
    });
  });

  describe('PATCH /forms/:id/received', () => {
    it('rejects marking RIS received until all required files are uploaded', async () => {
      prisma.Form.findUnique.mockResolvedValue(createdForm({
        Form_Type: 'RIS',
        Department: 'PURCHASING',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Department Head' },
          { Department: 'DEAN_OFFICE', Notes: 'Dean Office' },
          { Department: 'TNS', Notes: 'TNS' },
          { Department: 'PURCHASING', Notes: 'Purchasing' },
        ],
        Attachments: [],
      }));

      const res = await request(app)
        .patch('/forms/1/received')
        .send({ isReceived: true });

      expect(res.status).toBe(400);
      expect(res.body.missingDocumentTypes).toContain('PURCHASE_ORDER');
      expect(prisma.Form.update).not.toHaveBeenCalled();
    });

    it('marks RIS received after required files are uploaded', async () => {
      const requiredAttachments = [
        'PURCHASE_ORDER',
        'DELIVERY_RECEIPT',
        'RECEIVING_REPORT',
        'SALES_INVOICE',
      ].map((Document_Type, index) => ({
        Attachment_ID: index + 1,
        Form_ID: 1,
        Department: 'PURCHASING',
        Document_Type,
        File_Name: `${Document_Type}.pdf`,
        File_URL: `https://example.test/uploads/${Document_Type}.pdf`,
        Uploaded_By: 9999,
        Uploaded_At: new Date().toISOString(),
      }));
      const existingForm = createdForm({
        Form_Type: 'RIS',
        Department: 'PURCHASING',
        History: [
          { Department: 'REQUESTOR', Notes: 'Form created' },
          { Department: 'DEPARTMENT_HEAD', Notes: 'Department Head' },
          { Department: 'DEAN_OFFICE', Notes: 'Dean Office' },
          { Department: 'TNS', Notes: 'TNS' },
          { Department: 'PURCHASING', Notes: 'Purchasing' },
        ],
        Attachments: requiredAttachments,
      });
      prisma.Form.findUnique.mockResolvedValue(existingForm);
      prisma.Form.update.mockResolvedValue({
        ...existingForm,
        Is_Received: true,
        Received_By: 9999,
        Received_At: new Date().toISOString(),
      });

      const res = await request(app)
        .patch('/forms/1/received')
        .send({ isReceived: true });

      expect(res.status).toBe(200);
      expect(res.body.data.Is_Received).toBe(true);
      expect(prisma.Form.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { Form_ID: 1 },
          data: expect.objectContaining({
            Is_Received: true,
            Received_By: 9999,
          }),
        })
      );
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
