const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Generate form code (e.g., WRF-2026-001)
const generateFormCode = async (formType) => {
    const year = new Date().getFullYear();
    const prefix = `${formType}-${year}`;

    // Count existing forms with this prefix
    const count = await prisma.form.count({
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
router.get('/', async (req, res) => {
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

        const forms = await prisma.form.findMany({
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
router.get('/:id', async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const form = await prisma.form.findUnique({
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
router.post('/', async (req, res) => {
    try {
        const {
            creatorId,
            formType,
            title,
            content,
            fileName,
            fileUrl,
            fileType,
            department = 'REGISTRAR'
        } = req.body;

        if (!creatorId || !formType) {
            return res.status(400).json({ error: 'Creator ID and Form Type are required' });
        }

        // Validate form type
        if (!['WRF', 'RIS'].includes(formType)) {
            return res.status(400).json({ error: 'Invalid form type. Must be WRF or RIS' });
        }

        // Generate form code
        const formCode = await generateFormCode(formType);

        // Create form with initial history entry
        const form = await prisma.form.create({
            data: {
                Form_Code: formCode,
                Creator_ID: parseInt(creatorId),
                Form_Type: formType,
                Title: title || null,
                Content: content || null,
                Department: department,
                File_Name: fileName || null,
                File_URL: fileUrl || null,
                File_Type: fileType || null,
                History: {
                    create: {
                        Department: department,
                        Notes: 'Form created'
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
                History: true
            }
        });

        res.status(201).json(form);
    } catch (error) {
        console.error('Error creating form:', error);
        res.status(500).json({ error: 'Failed to create form', details: error.message });
    }
});

// PATCH /api/forms/:id - Update form (status, approver, etc.)
router.patch('/:id', async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const { status, approverId, title, content } = req.body;

        const updateData = {};

        if (status) {
            // Validate status
            if (!['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updateData.Status = status;
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

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: updateData,
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

        res.json(form);
    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ error: 'Failed to update form', details: error.message });
    }
});

// PATCH /api/forms/:id/archive - Archive form
router.patch('/:id/archive', async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                Is_Archived: true,
                Status: 'ARCHIVED'
            }
        });

        res.json(form);
    } catch (error) {
        console.error('Error archiving form:', error);
        res.status(500).json({ error: 'Failed to archive form', details: error.message });
    }
});

// POST /api/forms/:id/transfer - Transfer form to department
router.post('/:id/transfer', async (req, res) => {
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
        const form = await prisma.form.update({
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

        res.json(form);
    } catch (error) {
        console.error('Error transferring form:', error);
        res.status(500).json({ error: 'Failed to transfer form', details: error.message });
    }
});

// DELETE /api/forms/:id - Delete form (hard delete)
router.delete('/:id', async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ error: 'Invalid form ID' });
    }

    try {
        await prisma.form.delete({
            where: { Form_ID: formId }
        });

        res.json({ message: 'Form deleted successfully' });
    } catch (error) {
        console.error('Error deleting form:', error);
        res.status(500).json({ error: 'Failed to delete form', details: error.message });
    }
});

module.exports = router;
