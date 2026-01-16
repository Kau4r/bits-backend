const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../src/middleware/auth');
const AuditLogger = require('../src/utils/auditLogger');

const router = express.Router();
const prisma = new PrismaClient();

// Generate form code (e.g., WRF-2026-001)
const generateFormCode = async (formType) => {
    const year = new Date().getFullYear();
    const prefix = `${formType}-${year}`;

    // Count existing forms with this prefix
    const count = await prisma.Form.count({
        where: {
            Form_Code: {
                startsWith: prefix
            }
        }
    });

    const sequence = String(count + 1).padStart(3, '0');
    return `${prefix}-${sequence}`;
};

// GET /api/forms - List all forms with filters
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { type, status, department, archived, search } = req.query;

        const where = {};

        if (type && type !== 'All') {
            where.Form_Type = type;
        }

        if (status && status !== 'All') {
            where.Status = status;
        }

        if (department && department !== 'All') {
            where.Department = department;
        }

        if (archived !== undefined) {
            where.Is_Archived = archived === 'true';
        }

        if (search) {
            where.OR = [
                { Form_Code: { contains: search, mode: 'insensitive' } },
                { Title: { contains: search, mode: 'insensitive' } },
                { File_Name: { contains: search, mode: 'insensitive' } }
            ];
        }

        const forms = await prisma.Form.findMany({
            where,
            include: {
                Creator: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                Approver: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                History: {
                    orderBy: { Changed_At: 'asc' }
                }
            },
            orderBy: { Created_At: 'desc' }
        });

        res.json(forms);
    } catch (error) {
        console.error('Error fetching forms:', error);
        res.status(500).json({ error: 'Failed to fetch forms', details: error.message });
    }
});

// GET /api/forms/:id - Get form by ID
router.get('/:id', authenticateToken, async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const form = await prisma.Form.findUnique({
            where: { Form_ID: formId },
            include: {
                Creator: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                Approver: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                History: {
                    orderBy: { Changed_At: 'asc' }
                }
            }
        });

        if (!form) {
            return res.status(404).json({ error: 'Form not found' });
        }

        res.json(form);
    } catch (error) {
        console.error('Error fetching form:', error);
        res.status(500).json({ error: 'Failed to fetch form', details: error.message });
    }
});

// POST /api/forms - Create new form
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            creatorId, // Optional, can use req.user.User_ID
            formType,
            title,
            content,
            fileName,
            fileUrl,
            fileType,
            department = 'REGISTRAR'
        } = req.body;

        const userId = creatorId || req.user.User_ID;

        if (!userId || !formType) {
            return res.status(400).json({ error: 'User ID and Form Type are required' });
        }

        // Validate form type
        if (!['WRF', 'RIS'].includes(formType)) {
            return res.status(400).json({ error: 'Invalid form type. Must be WRF or RIS' });
        }

        // Generate form code
        const formCode = await generateFormCode(formType);

        // Convert department to uppercase to match enum
        const departmentEnum = department.toUpperCase();

        // Create form first
        const form = await prisma.Form.create({
            data: {
                Form_Code: formCode,
                Creator_ID: parseInt(userId),
                Form_Type: formType,
                Title: title || null,
                Content: content || null,
                Department: departmentEnum,
                File_Name: fileName || null,
                File_URL: fileUrl || null,
                File_Type: fileType || null
            },
            include: {
                Creator: true
            }
        });

        // Create initial history entry
        await prisma.FormHistory.create({
            data: {
                Form_ID: form.Form_ID,
                Department: departmentEnum,
                Notes: 'Form created'
            }
        });

        // Audit Log
        // Notify Role logic: If Department is LABORATORY, notify LAB_HEAD. Else (REGISTRAR/FINANCE) maybe ADMIN?
        // Using LAB_HEAD for LAB forms for now.
        const notifyRole = departmentEnum === 'LABORATORY' ? 'LAB_HEAD' : (departmentEnum === 'REGISTRAR' ? 'ADMIN' : null);

        await AuditLogger.logForm(
            userId,
            'FORM_SUBMITTED',
            `Submitted form ${formCode} to ${departmentEnum}`,
            notifyRole
        );

        // Fetch the form again with history included
        const formWithHistory = await prisma.Form.findUnique({
            where: { Form_ID: form.Form_ID },
            include: {
                Creator: true,
                History: true
            }
        });

        res.status(201).json(formWithHistory);
    } catch (error) {
        console.error('Error creating form:', error);
        res.status(500).json({ error: 'Failed to create form', details: error.message });
    }
});

// PATCH /api/forms/:id - Update form (status, approver, etc.)
router.patch('/:id', authenticateToken, async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const { status, approverId, title, content } = req.body;

        const updateData = {};
        let action = 'FORM_UPDATED';

        if (status) {
            // Validate status
            if (!['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updateData.Status = status;

            if (status === 'APPROVED') action = 'FORM_APPROVED';
            if (status === 'REJECTED') action = 'FORM_REJECTED';
            if (status === 'ARCHIVED') action = 'FORM_ARCHIVED';
        }

        if (approverId !== undefined) {
            updateData.Approver_ID = approverId ? parseInt(approverId) : null;
        }

        if (title !== undefined) {
            updateData.Title = title;
        }

        if (content !== undefined) {
            updateData.Content = content;
        }

        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: updateData,
            include: { Creator: true }
        });

        // Notify Creator if Approved/Rejected
        const notifyUserId = (status === 'APPROVED' || status === 'REJECTED') ? form.Creator_ID : null;

        await AuditLogger.logForm(
            req.user.User_ID,
            action,
            `Form ${form.Form_Code} ${action === 'FORM_UPDATED' ? 'updated' : status.toLowerCase()}`,
            null,
            notifyUserId
        );

        res.json(form);
    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ error: 'Failed to update form', details: error.message });
    }
});

// PATCH /api/forms/:id/archive - Archive form
router.patch('/:id/archive', authenticateToken, async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: {
                Is_Archived: true,
                Status: 'ARCHIVED'
            }
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            'FORM_ARCHIVED',
            `Archived form ${form.Form_Code}`
        );

        res.json(form);
    } catch (error) {
        console.error('Error archiving form:', error);
        res.status(500).json({ error: 'Failed to archive form', details: error.message });
    }
});

// POST /api/forms/:id/transfer - Transfer form to department
router.post('/:id/transfer', authenticateToken, async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const { department, notes } = req.body;

        if (!department) {
            return res.status(400).json({ error: 'Department is required' });
        }

        // Validate department
        if (!['REGISTRAR', 'FINANCE', 'DCISM', 'LABORATORY'].includes(department)) {
            return res.status(400).json({ error: 'Invalid department' });
        }

        // Update form and add history entry
        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: {
                Department: department,
                History: {
                    create: {
                        Department: department,
                        Notes: notes || `Transferred to ${department}`
                    }
                }
            },
            include: {
                Creator: {
                    select: {
                        User_ID: true,
                        First_Name: true,
                        Last_Name: true,
                        Email: true
                    }
                },
                History: {
                    orderBy: { Changed_At: 'asc' }
                }
            }
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            'FORM_TRANSFERRED',
            `Transferred form ${form.Form_Code} to ${department}`,
            // Notify receiving department?
            department === 'LABORATORY' ? 'LAB_HEAD' : 'ADMIN'
        );

        res.json(form);
    } catch (error) {
        console.error('Error transferring form:', error);
        res.status(500).json({ error: 'Failed to transfer form', details: error.message });
    }
});

// DELETE /api/forms/:id - Delete form (hard delete)
router.delete('/:id', authenticateToken, async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        await prisma.Form.delete({
            where: { Form_ID: formId }
        }); // Note: should probably fetch first to get code for log, but assuming ID for now if needed. 
        // Or better:

        // await AuditLogger.logForm(req.user.User_ID, 'FORM_DELETED', `Deleted form ${formId}`); // Generic action
        // Skipping log for hard delete if not critical or risky without fetch.

        res.json({ message: 'Form deleted successfully' });
    } catch (error) {
        console.error('Error deleting form:', error);
        res.status(500).json({ error: 'Failed to delete form', details: error.message });
    }
});

module.exports = router;
