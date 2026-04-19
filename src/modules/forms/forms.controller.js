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

const VALID_FORM_DOCUMENT_TYPES = [
    'INITIAL',
    'PURCHASE_ORDER',
    'DELIVERY_RECEIPT',
    'RECEIVING_REPORT',
    'SALES_INVOICE',
    'PROOF',
    'OTHER'
];

const RIS_REQUIRED_COMPLETION_DOCUMENT_TYPES = [
    'PURCHASE_ORDER',
    'DELIVERY_RECEIPT',
    'RECEIVING_REPORT',
    'SALES_INVOICE'
];

const DOCUMENT_TYPE_LABELS = {
    PURCHASE_ORDER: 'Purchase Order',
    DELIVERY_RECEIPT: 'Delivery Receipt',
    RECEIVING_REPORT: 'Receiving Report',
    SALES_INVOICE: 'Sales Invoice'
};

const normalizeDepartment = (department = 'REQUESTOR') => String(department).toUpperCase();
const isValidDepartment = (department) => VALID_FORM_DEPARTMENTS.includes(department);
const getWorkflowForFormType = (formType) => FORM_DEPARTMENT_WORKFLOWS[String(formType || '').toUpperCase()] || [];
const normalizeDocumentType = (documentType = 'PROOF') =>
    String(documentType || 'PROOF').trim().toUpperCase().replace(/[\s-]+/g, '_');
const isValidDocumentType = (documentType) => VALID_FORM_DOCUMENT_TYPES.includes(documentType);

const userSelect = {
    User_ID: true,
    First_Name: true,
    Last_Name: true,
    Email: true
};

const formInclude = {
    Creator: {
        select: userSelect
    },
    Approver: {
        select: userSelect
    },
    Receiver: {
        select: userSelect
    },
    History: {
        orderBy: { Changed_At: 'asc' }
    },
    Attachments: {
        orderBy: { Uploaded_At: 'asc' },
        include: {
            Uploader: {
                select: userSelect
            }
        }
    }
};

const normalizeAttachmentInput = (attachment, fallbackDepartment, fallbackUploaderId, fallbackDocumentType = 'PROOF') => {
    const fileName = String(attachment?.fileName || attachment?.File_Name || '').trim();
    const fileUrl = String(attachment?.fileUrl || attachment?.File_URL || '').trim();
    const department = normalizeDepartment(attachment?.department || attachment?.Department || fallbackDepartment);
    const documentType = normalizeDocumentType(attachment?.documentType || attachment?.Document_Type || fallbackDocumentType);

    if (!fileName || !fileUrl) {
        return { error: 'Attachment file name and URL are required' };
    }

    if (!isValidDepartment(department)) {
        return { error: 'Invalid attachment department' };
    }

    if (!isValidDocumentType(documentType)) {
        return { error: 'Invalid attachment document type' };
    }

    return {
        data: {
            Department: department,
            Document_Type: documentType,
            File_Name: fileName,
            File_URL: fileUrl,
            File_Type: attachment?.fileType || attachment?.File_Type || null,
            Uploaded_By: attachment?.uploadedBy ? parseInt(attachment.uploadedBy) : fallbackUploaderId,
            Notes: attachment?.notes || attachment?.Notes || null
        }
    };
};

const buildAttachmentCreateData = (attachments, fallbackDepartment, fallbackUploaderId, fallbackDocumentType = 'PROOF') => {
    const normalizedAttachments = [];

    for (const attachment of attachments) {
        const normalized = normalizeAttachmentInput(attachment, fallbackDepartment, fallbackUploaderId, fallbackDocumentType);
        if (normalized.error) {
            return { error: normalized.error };
        }
        normalizedAttachments.push(normalized.data);
    }

    return { data: normalizedAttachments };
};

const getVisitedWorkflowDepartments = (form) => {
    const workflow = getWorkflowForFormType(form.Form_Type);
    const visitedDepartments = new Set(
        (form.History || [])
            .map(history => normalizeDepartment(history.Department))
            .filter(department => workflow.includes(department))
    );

    const currentDepartment = normalizeDepartment(form.Department);
    if (workflow.includes(currentDepartment)) {
        visitedDepartments.add(currentDepartment);
    }

    return { workflow, visitedDepartments, currentDepartment };
};

const getTransferGate = (form, targetDepartment) => {
    const workflow = getWorkflowForFormType(form.Form_Type);

    if (!workflow.includes(targetDepartment)) {
        return {
            allowed: false,
            error: `Invalid department for ${form.Form_Type} form`
        };
    }

    const { visitedDepartments, currentDepartment } = getVisitedWorkflowDepartments(form);

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

const hasVisitedDepartment = (form, department) => {
    const { visitedDepartments } = getVisitedWorkflowDepartments(form);
    return visitedDepartments.has(department);
};

const getAttachmentDocumentTypes = (form) => new Set(
    (form.Attachments || [])
        .map(attachment => normalizeDocumentType(attachment.Document_Type || 'PROOF'))
        .filter(isValidDocumentType)
);

const getMissingRisCompletionDocuments = (form) => {
    const documentTypes = getAttachmentDocumentTypes(form);
    return RIS_REQUIRED_COMPLETION_DOCUMENT_TYPES.filter(documentType => !documentTypes.has(documentType));
};

const getRisCompletionState = (form) => {
    const missingDocumentTypes = getMissingRisCompletionDocuments(form);
    const isReceived = form.Is_Received === true;

    return {
        applies: String(form.Form_Type || '').toUpperCase() === 'RIS',
        requiredDocumentTypes: RIS_REQUIRED_COMPLETION_DOCUMENT_TYPES,
        missingDocumentTypes,
        missingDocumentLabels: missingDocumentTypes.map(type => DOCUMENT_TYPE_LABELS[type] || type),
        isReceived,
        documentsComplete: missingDocumentTypes.length === 0,
        canComplete: missingDocumentTypes.length === 0 && isReceived
    };
};

const buildRisCompletionError = (form) => {
    const state = getRisCompletionState(form);
    const missingLabels = state.missingDocumentLabels;
    const missingParts = [];

    if (missingLabels.length > 0) {
        missingParts.push(`missing ${missingLabels.join(', ')}`);
    }

    if (!state.isReceived) {
        missingParts.push('not marked received');
    }

    return {
        success: false,
        error: `RIS form cannot be completed until it is ${missingParts.join(' and ')}`,
        requiredDocumentTypes: state.requiredDocumentTypes,
        missingDocumentTypes: state.missingDocumentTypes,
        isReceived: state.isReceived
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
            include: formInclude,
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
            include: formInclude
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
            attachments = [],
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

        const attachmentInputs = Array.isArray(attachments) ? [...attachments] : [];
        if (fileName && fileUrl) {
            attachmentInputs.unshift({
                fileName,
                fileUrl,
                fileType,
                department: departmentEnum,
                documentType: 'INITIAL',
                notes: 'Initial form attachment'
            });
        }

        const seenAttachmentKeys = new Set();
        const dedupedAttachmentInputs = attachmentInputs.filter((attachment) => {
            const key = `${attachment?.fileName || attachment?.File_Name || ''}|${attachment?.fileUrl || attachment?.File_URL || ''}`;
            if (seenAttachmentKeys.has(key)) return false;
            seenAttachmentKeys.add(key);
            return true;
        });

        const attachmentCreate = buildAttachmentCreateData(dedupedAttachmentInputs, departmentEnum, parseInt(userId), 'INITIAL');
        if (attachmentCreate.error) {
            return res.status(400).json({ success: false, error: attachmentCreate.error });
        }

        const primaryAttachment = attachmentCreate.data[0];

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
                File_Name: primaryAttachment?.File_Name || fileName || null,
                File_URL: primaryAttachment?.File_URL || fileUrl || null,
                File_Type: primaryAttachment?.File_Type || fileType || null,
                Requester_Name: requesterName || null,
                Remarks: remarks || null,
                ...(attachmentCreate.data.length > 0 ? {
                    Attachments: {
                        create: attachmentCreate.data
                    }
                } : {})
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
            include: formInclude
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
            updateData.Is_Archived = status === 'ARCHIVED';

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
            include: formInclude
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
            include: formInclude
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

        if (String(existingForm.Form_Type || '').toUpperCase() === 'RIS' && departmentEnum === 'COMPLETED') {
            const completionState = getRisCompletionState(existingForm);
            if (!completionState.canComplete) {
                return res.status(400).json(buildRisCompletionError(existingForm));
            }
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
            include: formInclude
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

// PATCH /api/forms/:id/received - Toggle RIS received indicator
const setFormReceived = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const isReceived = req.body?.isReceived !== undefined ? req.body.isReceived === true : true;

        const existingForm = await prisma.Form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        if (String(existingForm.Form_Type || '').toUpperCase() !== 'RIS') {
            return res.status(400).json({ success: false, error: 'Received indicator is only required for RIS forms' });
        }

        if (!hasVisitedDepartment(existingForm, 'PURCHASING')) {
            return res.status(400).json({
                success: false,
                error: 'RIS form must reach Purchasing before it can be marked received'
            });
        }

        if (isReceived) {
            const missingDocumentTypes = getMissingRisCompletionDocuments(existingForm);
            if (missingDocumentTypes.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `RIS form cannot be marked received until required files are uploaded: ${missingDocumentTypes.map(type => DOCUMENT_TYPE_LABELS[type] || type).join(', ')}`,
                    requiredDocumentTypes: RIS_REQUIRED_COMPLETION_DOCUMENT_TYPES,
                    missingDocumentTypes
                });
            }
        }

        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: {
                Is_Received: isReceived,
                Received_At: isReceived ? new Date() : null,
                Received_By: isReceived ? req.user.User_ID : null
            },
            include: formInclude
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            isReceived ? 'FORM_RECEIVED' : 'FORM_RECEIVED_REVOKED',
            `${isReceived ? 'Marked' : 'Unmarked'} form ${form.Form_Code} as received`,
            getNotifyRoles(),
            form.Creator_ID
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error updating form received indicator:', error);
        res.status(500).json({ success: false, error: 'Failed to update received indicator' });
    }
};

// POST /api/forms/:id/attachments - Add one or more proof/supporting files
const addFormAttachments = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const existingForm = await prisma.Form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        const attachmentInputs = Array.isArray(req.body.attachments)
            ? req.body.attachments
            : [req.body];

        if (attachmentInputs.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one attachment is required' });
        }

        const attachmentCreate = buildAttachmentCreateData(
            attachmentInputs,
            existingForm.Department,
            req.user.User_ID
        );

        if (attachmentCreate.error) {
            return res.status(400).json({ success: false, error: attachmentCreate.error });
        }

        const workflow = getWorkflowForFormType(existingForm.Form_Type);
        const invalidDepartment = attachmentCreate.data.find(attachment => !workflow.includes(attachment.Department));
        if (invalidDepartment) {
            return res.status(400).json({
                success: false,
                error: `Invalid attachment department for ${existingForm.Form_Type} form`
            });
        }

        const firstAttachment = attachmentCreate.data[0];
        const shouldSetLegacyFile = !existingForm.File_URL && firstAttachment;

        const form = await prisma.Form.update({
            where: { Form_ID: formId },
            data: {
                ...(shouldSetLegacyFile ? {
                    File_Name: firstAttachment.File_Name,
                    File_URL: firstAttachment.File_URL,
                    File_Type: firstAttachment.File_Type
                } : {}),
                Attachments: {
                    create: attachmentCreate.data
                }
            },
            include: formInclude
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            'FORM_ATTACHMENT_ADDED',
            `Added ${attachmentCreate.data.length} attachment(s) to form ${form.Form_Code}`,
            getNotifyRoles(),
            form.Creator_ID
        );

        res.status(201).json({ success: true, data: form });
    } catch (error) {
        console.error('Error adding form attachment:', error);
        res.status(500).json({ success: false, error: 'Failed to add form attachment' });
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
    setFormReceived,
    addFormAttachments,
    deleteForm
};
