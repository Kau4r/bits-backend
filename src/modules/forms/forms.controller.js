const prisma = require('../../lib/prisma');
const AuditLogger = require('../../utils/auditLogger');

const VALID_FORM_DEPARTMENTS = [
    'REQUESTOR',
    'DEPARTMENT_HEAD',
    'DEAN_OFFICE',
    'TNS',
    'PURCHASING',
    'PPFO',
    'COMPLETED'
];

const FORM_DEPARTMENT_WORKFLOWS = {
    WRF: ['REQUESTOR', 'DEPARTMENT_HEAD', 'PPFO', 'COMPLETED'],
    RIS: ['REQUESTOR', 'DEPARTMENT_HEAD', 'DEAN_OFFICE', 'TNS', 'PURCHASING', 'COMPLETED']
};

const normalizeDepartment = (department = 'REQUESTOR') => String(department).toUpperCase();
const isValidDepartment = (department) => VALID_FORM_DEPARTMENTS.includes(department);
const getWorkflowForFormType = (formType) => FORM_DEPARTMENT_WORKFLOWS[String(formType || '').toUpperCase()] || [];

const getTransferGate = (form, targetDepartment) => {
    const workflow = getWorkflowForFormType(form.Form_Type);

    if (!workflow.includes(targetDepartment)) {
        return {
            allowed: false,
            error: `Invalid department for ${form.Form_Type} form`
        };
    }

    const visitedDepartments = new Set(
        (form.History || [])
            .map(history => normalizeDepartment(history.Department))
            .filter(department => workflow.includes(department))
    );

    const currentDepartment = normalizeDepartment(form.Department);
    if (workflow.includes(currentDepartment)) {
        visitedDepartments.add(currentDepartment);
    }

    if (targetDepartment === currentDepartment) {
        return { allowed: true, noChange: true };
    }

    if (visitedDepartments.has(targetDepartment)) {
        return { allowed: true };
    }

    const nextRequiredDepartment = workflow.find(department => !visitedDepartments.has(department));

    if (targetDepartment === nextRequiredDepartment) {
        return { allowed: true };
    }

    return {
        allowed: false,
        error: nextRequiredDepartment
            ? `Cannot transfer to ${targetDepartment} before visiting ${nextRequiredDepartment}`
            : `Cannot transfer to ${targetDepartment}`
    };
};

// Workflow form events should notify the lab operations roles.
const getNotifyRoles = () => {
    return ['LAB_TECH', 'LAB_HEAD'];
};

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
const getForms = async (req, res) => {
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
            const departmentEnum = normalizeDepartment(department);
            if (!isValidDepartment(departmentEnum)) {
                return res.status(400).json({ success: false, error: 'Invalid department' });
            }
            where.Department = departmentEnum;
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

        res.json({ success: true, data: forms });
    } catch (error) {
        console.error('Error fetching forms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch forms' });
    }
};

// GET /api/forms/:id - Get form by ID
const getFormById = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
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
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error fetching form:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch form' });
    }
};

// POST /api/forms - Create new form
const createForm = async (req, res) => {
    try {
        const {
            creatorId, // Optional, can use req.user.User_ID
            formType,
            title,
            content,
            fileName,
            fileUrl,
            fileType,
            department = 'REQUESTOR',
            requesterName,
            remarks
        } = req.body;

        const userId = creatorId || req.user.User_ID;
        const formTypeEnum = String(formType || '').toUpperCase();

        if (!userId || !formType) {
            return res.status(400).json({ success: false, error: 'User ID and Form Type are required' });
        }

        // Validate form type
        if (!['WRF', 'RIS'].includes(formTypeEnum)) {
            return res.status(400).json({ success: false, error: 'Invalid form type. Must be WRF or RIS' });
        }

        // Convert and validate department before Prisma sees it, so invalid enum values return 400.
        const departmentEnum = normalizeDepartment(department);
        if (!isValidDepartment(departmentEnum)) {
            return res.status(400).json({ success: false, error: 'Invalid department' });
        }

        // Generate form code
        const formCode = await generateFormCode(formTypeEnum);

        // Create form first
        const form = await prisma.Form.create({
            data: {
                Form_Code: formCode,
                Creator_ID: parseInt(userId),
                Form_Type: formTypeEnum,
                Title: title || null,
                Content: content || null,
                Department: departmentEnum,
                File_Name: fileName || null,
                File_URL: fileUrl || null,
                File_Type: fileType || null,
                Requester_Name: requesterName || null,
                Remarks: remarks || null
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
        const notifyRole = getNotifyRoles();

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

        res.status(201).json({ success: true, data: formWithHistory });
    } catch (error) {
        console.error('Error creating form:', error);
        res.status(500).json({ success: false, error: 'Failed to create form' });
    }
};

// PATCH /api/forms/:id - Update form (status, approver, etc.)
const updateForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const { status, approverId, title, content, requesterName, remarks, fileName, fileUrl, fileType } = req.body;

        const updateData = {};
        let action = 'FORM_UPDATED';

        if (status) {
            // Validate status
            if (!['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            updateData.Status = status;

            if (status === 'APPROVED') action = 'FORM_APPROVED';
            if (status === 'REJECTED') action = 'FORM_REJECTED';
            if (status === 'ARCHIVED') action = 'FORM_ARCHIVED';
            if (status === 'PENDING') action = 'FORM_PENDING';
            if (status === 'IN_REVIEW') action = 'FORM_IN_REVIEW';
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

        if (requesterName !== undefined) {
            updateData.Requester_Name = requesterName || null;
        }

        if (remarks !== undefined) {
            updateData.Remarks = remarks || null;
        }

        if (fileName !== undefined) {
            updateData.File_Name = fileName || null;
        }

        if (fileUrl !== undefined) {
            updateData.File_URL = fileUrl || null;
        }

        if (fileType !== undefined) {
            updateData.File_Type = fileType || null;
        }

        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: updateData,
            include: { Creator: true }
        });

        // Notify Creator if status changes to Approved, Rejected, Pending, or In Review
        const notifyUserId = ['APPROVED', 'REJECTED', 'PENDING', 'IN_REVIEW'].includes(status) ? form.Creator_ID : null;

        const notifyAuditRole = getNotifyRoles();

        await AuditLogger.logForm(
            req.user.User_ID,
            action,
            `Form ${form.Form_Code} ${action === 'FORM_UPDATED' ? 'updated' : status.toLowerCase()}`,
            notifyAuditRole,
            notifyUserId
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ success: false, error: 'Failed to update form' });
    }
};

// PATCH /api/forms/:id/archive - Archive form
const archiveForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
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
            `Archived form ${form.Form_Code}`,
            getNotifyRoles()
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error archiving form:', error);
        res.status(500).json({ success: false, error: 'Failed to archive form' });
    }
};

// POST /api/forms/:id/transfer - Transfer form to department
const transferForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const { department, notes } = req.body;

        if (!department) {
            return res.status(400).json({ success: false, error: 'Department is required' });
        }

        const departmentEnum = normalizeDepartment(department);

        // Validate department
        if (!isValidDepartment(departmentEnum)) {
            return res.status(400).json({ success: false, error: 'Invalid department' });
        }

        const existingForm = await prisma.Form.findUnique({
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
                History: {
                    orderBy: { Changed_At: 'asc' }
                }
            }
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        const transferGate = getTransferGate(existingForm, departmentEnum);
        if (!transferGate.allowed) {
            return res.status(400).json({ success: false, error: transferGate.error });
        }

        if (transferGate.noChange) {
            return res.json({ success: true, data: existingForm });
        }

        // Update form and add history entry
        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: {
                Department: departmentEnum,
                History: {
                    create: {
                        Department: departmentEnum,
                        Notes: notes || `Transferred to ${departmentEnum}`
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
            `Transferred form ${form.Form_Code} to ${departmentEnum}`,
            getNotifyRoles()
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error transferring form:', error);
        res.status(500).json({ success: false, error: 'Failed to transfer form' });
    }
};

// DELETE /api/forms/:id - Delete form (hard delete)
const deleteForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        await prisma.Form.delete({
            where: { Form_ID: formId }
        });

        res.json({ success: true, data: { message: 'Form deleted successfully' } });
    } catch (error) {
        console.error('Error deleting form:', error);
        res.status(500).json({ success: false, error: 'Failed to delete form' });
    }
};

module.exports = {
    getForms,
    getFormById,
    createForm,
    updateForm,
    archiveForm,
    transferForm,
    deleteForm
};
