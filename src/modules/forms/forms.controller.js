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
    // Legacy RIS kept for any pre-migration rows; new forms should use RIS_E or RIS_NE.
    RIS: ['REQUESTOR', 'DEPARTMENT_HEAD', 'DEAN_OFFICE', 'TNS', 'PURCHASING', 'COMPLETED'],
    RIS_E: ['REQUESTOR', 'DEPARTMENT_HEAD', 'DEAN_OFFICE', 'TNS', 'PURCHASING', 'COMPLETED'],
    RIS_NE: ['REQUESTOR', 'DEPARTMENT_HEAD', 'DEAN_OFFICE', 'PPFO', 'PURCHASING', 'COMPLETED']
};

const VALID_FORM_TYPES = ['WRF', 'RIS', 'RIS_E', 'RIS_NE'];
const isRisFormType = (formType) => {
    const t = String(formType || '').toUpperCase();
    return t === 'RIS' || t === 'RIS_E' || t === 'RIS_NE';
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

const FORM_QUERY_STATUSES = ['PENDING', 'IN_REVIEW', 'APPROVED', 'CANCELLED', 'ARCHIVED'];
const FORM_UPDATE_STATUSES = ['PENDING', 'IN_REVIEW', 'APPROVED', 'CANCELLED'];
const FORM_TERMINAL_STATUSES = ['CANCELLED', 'ARCHIVED'];
const FORM_STATUS_AUDIT_ACTIONS = {
    PENDING: 'FORM_PENDING',
    IN_REVIEW: 'FORM_IN_REVIEW',
    APPROVED: 'FORM_APPROVED',
    CANCELLED: 'FORM_CANCELLED'
};
const FORM_STATUS_LABELS = {
    PENDING: 'pending',
    IN_REVIEW: 'in review',
    APPROVED: 'approved',
    CANCELLED: 'cancelled',
    ARCHIVED: 'archived'
};

const normalizeDepartment = (department = 'REQUESTOR') => String(department).toUpperCase();
const normalizeFormStatus = (status) => String(status || '').trim().toUpperCase();
const isValidDepartment = (department) => VALID_FORM_DEPARTMENTS.includes(department);
const isFormTerminal = (form) => {
    const dept = normalizeDepartment(form?.Department);
    const status = normalizeFormStatus(form?.Status);
    return dept === 'COMPLETED' || FORM_TERMINAL_STATUSES.includes(status);
};
const isFormHardLocked = (form) => FORM_TERMINAL_STATUSES.includes(normalizeFormStatus(form?.Status));
const getWorkflowForFormType = (formType) => FORM_DEPARTMENT_WORKFLOWS[String(formType || '').toUpperCase()] || [];
const normalizeOptionalText = (value) => {
    const text = String(value || '').trim();
    return text || null;
};
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
        orderBy: { Changed_At: 'asc' },
        include: {
            Performer: {
                select: userSelect
            }
        }
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

const hasCurrentStepAttachment = (form) => {
    const currentDept = normalizeDepartment(form?.Department);

    // Find the most recent arrival at this step (TRANSFERRED or RETURNED history entry).
    const arrivalEntry = (form.History || [])
        .filter(h => {
            const dept = normalizeDepartment(h.Department);
            const action = String(h.Action || 'TRANSFERRED').toUpperCase();
            return dept === currentDept && ['TRANSFERRED', 'RETURNED'].includes(action);
        })
        .sort((a, b) => new Date(b.Changed_At).getTime() - new Date(a.Changed_At).getTime())[0];

    // Fallback: any history entry for this dept (handles legacy records that predate Action column).
    const fallbackEntry = !arrivalEntry ? (form.History || [])
        .filter(h => normalizeDepartment(h.Department) === currentDept)
        .sort((a, b) => new Date(b.Changed_At).getTime() - new Date(a.Changed_At).getTime())[0] : null;

    const arrivalTime = arrivalEntry?.Changed_At
        || fallbackEntry?.Changed_At
        || form.Created_At;

    // Must have a non-INITIAL attachment for this step uploaded after the latest arrival.
    return (form.Attachments || []).some(a => {
        const aDept = normalizeDepartment(a.Department);
        const docType = normalizeDocumentType(a.Document_Type || 'PROOF');
        const uploadTime = a.Uploaded_At;
        return aDept === currentDept
            && docType !== 'INITIAL'
            && new Date(uploadTime).getTime() > new Date(arrivalTime).getTime();
    });
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
        applies: isRisFormType(form.Form_Type),
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

// Generate user-scoped form code (e.g., WRF-2026-U12-001)
const generateFormCode = async (formType, userId) => {
    const year = new Date().getFullYear();
    const typePrefix = isRisFormType(formType) ? 'RIS' : 'WRF';
    const parsedUserId = parseInt(userId);
    const prefix = `${typePrefix}-${year}-U${parsedUserId}`;

    // Count this user's existing forms with this display prefix.
    const count = await prisma.form.count({
        where: {
            Creator_ID: parsedUserId,
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
            const statusEnum = normalizeFormStatus(status);
            if (!FORM_QUERY_STATUSES.includes(statusEnum)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            where.Status = statusEnum;
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

        const forms = await prisma.form.findMany({
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
        const form = await prisma.form.findUnique({
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
            formNumber,
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
        if (!VALID_FORM_TYPES.includes(formTypeEnum)) {
            return res.status(400).json({ success: false, error: `Invalid form type. Must be one of: ${VALID_FORM_TYPES.join(', ')}` });
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

        const formCode = normalizeOptionalText(formNumber)?.toUpperCase();
        if (!formCode) {
            return res.status(400).json({ success: false, error: 'Form number is required' });
        }

        const duplicateForm = await prisma.form.findUnique({
            where: { Form_Code: formCode }
        });

        if (duplicateForm) {
            return res.status(409).json({ success: false, error: 'Form number already exists' });
        }

        // Create form first
        const form = await prisma.form.create({
            data: {
                Form_Code: formCode,
                Creator_ID: parseInt(userId),
                Form_Type: formTypeEnum,
                Title: normalizeOptionalText(title),
                Content: normalizeOptionalText(content),
                Department: departmentEnum,
                File_Name: primaryAttachment?.File_Name || fileName || null,
                File_URL: primaryAttachment?.File_URL || fileUrl || null,
                File_Type: primaryAttachment?.File_Type || fileType || null,
                Requester_Name: normalizeOptionalText(requesterName),
                Remarks: normalizeOptionalText(remarks),
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
        await prisma.formHistory.create({
            data: {
                Form_ID: form.Form_ID,
                Department: departmentEnum,
                Notes: 'Form created',
                Performed_By: parseInt(userId),
                Action: 'CREATED'
            }
        });

        // Audit Log
        const notifyRole = getNotifyRoles();

        try {
            await AuditLogger.logForm(
                userId,
                'FORM_SUBMITTED',
                `Submitted form ${formCode} to ${departmentEnum}`,
                notifyRole
            );
        } catch (auditError) {
            console.error('Failed to write form submission audit log:', auditError);
        }

        // Fetch the form again with history included
        const formWithHistory = await prisma.form.findUnique({
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
        const statusEnum = status !== undefined ? normalizeFormStatus(status) : undefined;

        const existing = await prisma.form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });
        if (!existing) return res.status(404).json({ success: false, error: 'Form not found' });
        if (isFormHardLocked(existing)) {
            return res.status(400).json({ success: false, error: 'Form is in a terminal state and cannot be modified' });
        }

        const updateData = {};
        let action = 'FORM_UPDATED';

        if (status !== undefined) {
            if (statusEnum === 'ARCHIVED') {
                return res.status(400).json({ success: false, error: 'Use the archive endpoint to archive forms' });
            }

            if (!FORM_UPDATE_STATUSES.includes(statusEnum)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }

            updateData.Status = statusEnum;
            updateData.Is_Archived = false;
            action = FORM_STATUS_AUDIT_ACTIONS[statusEnum] || 'FORM_UPDATED';
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

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: updateData,
            include: formInclude
        });

        // Write history entry for approval/cancellation decisions.
        if (statusEnum === 'APPROVED' || statusEnum === 'CANCELLED') {
            await prisma.formHistory.create({
                data: {
                    Form_ID: formId,
                    Department: form.Department,
                    Notes: `Form ${FORM_STATUS_LABELS[statusEnum]} by user`,
                    Performed_By: req.user.User_ID,
                    Action: statusEnum
                }
            });
        }

        // Notify Creator if status changes to Approved, Cancelled, Pending, or In Review.
        const notifyUserId = statusEnum && FORM_UPDATE_STATUSES.includes(statusEnum) ? form.Creator_ID : null;

        const notifyAuditRole = getNotifyRoles();
        const statusLabel = statusEnum ? FORM_STATUS_LABELS[statusEnum] : null;

        await AuditLogger.logForm(
            req.user.User_ID,
            action,
            `Form ${form.Form_Code} ${action === 'FORM_UPDATED' ? 'updated' : statusLabel}`,
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
        const existingForm = await prisma.form.findUnique({ where: { Form_ID: formId } });
        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }
        if (!isFormTerminal(existingForm)) {
            return res.status(400).json({
                success: false,
                error: 'Form can only be archived when it reaches a terminal state (Completed or Cancelled)'
            });
        }

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                Is_Archived: true,
                Status: 'ARCHIVED'
            }
        });

        await prisma.formHistory.create({
            data: {
                Form_ID: formId,
                Department: form.Department,
                Notes: 'Form archived',
                Performed_By: req.user.User_ID,
                Action: 'ARCHIVED'
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

// PATCH /api/forms/:id/unarchive - Restore archived form
const unarchiveForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const existingForm = await prisma.form.findUnique({ where: { Form_ID: formId } });
        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }
        if (!existingForm.Is_Archived && normalizeFormStatus(existingForm.Status) !== 'ARCHIVED') {
            return res.status(400).json({ success: false, error: 'Form is not archived' });
        }

        const restoredStatus = normalizeDepartment(existingForm.Department) === 'COMPLETED' ? 'APPROVED' : 'CANCELLED';
        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                Is_Archived: false,
                Status: restoredStatus
            }
        });

        await prisma.formHistory.create({
            data: {
                Form_ID: formId,
                Department: form.Department,
                Notes: 'Form unarchived',
                Performed_By: req.user.User_ID,
                Action: restoredStatus
            }
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            'FORM_UNARCHIVED',
            `Unarchived form ${form.Form_Code}`,
            getNotifyRoles()
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error unarchiving form:', error);
        res.status(500).json({ success: false, error: 'Failed to unarchive form' });
    }
};

// POST /api/forms/:id/transfer - Transfer form to department
const transferForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        const { department, notes, reason } = req.body;

        if (!department) {
            return res.status(400).json({ success: false, error: 'Department is required' });
        }

        const departmentEnum = normalizeDepartment(department);

        // Validate department
        if (!isValidDepartment(departmentEnum)) {
            return res.status(400).json({ success: false, error: 'Invalid department' });
        }

        const existingForm = await prisma.form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        if (isFormHardLocked(existingForm)) {
            return res.status(400).json({ success: false, error: 'Form is in a terminal state and cannot be transferred' });
        }

        const transferGate = getTransferGate(existingForm, departmentEnum);
        if (!transferGate.allowed) {
            return res.status(400).json({ success: false, error: transferGate.error });
        }

        if (transferGate.noChange) {
            return res.json({ success: true, data: existingForm });
        }

        // Detect backward transfer: target department was already visited AND is not the next required step
        const { visitedDepartments } = getVisitedWorkflowDepartments(existingForm);
        const workflow = getWorkflowForFormType(existingForm.Form_Type);
        const nextRequiredDepartment = workflow.find(d => !visitedDepartments.has(d));
        const isBackwardTransfer = visitedDepartments.has(departmentEnum) && departmentEnum !== nextRequiredDepartment;

        if (isBackwardTransfer) {
            const trimmedReason = String(reason || '').trim();
            if (!trimmedReason) {
                return res.status(400).json({
                    success: false,
                    error: 'Reason required when returning a form to a previous step'
                });
            }
        } else {
            // Forward transfer: still requires APPROVED status
            if (existingForm.Status !== 'APPROVED') {
                return res.status(400).json({
                    success: false,
                    error: 'Form must be approved before it can be transferred to another department'
                });
            }
        }

        if (!isBackwardTransfer && departmentEnum === 'COMPLETED' && !hasCurrentStepAttachment(existingForm)) {
            const currentDept = normalizeDepartment(existingForm.Department);
            return res.status(400).json({
                success: false,
                error: `Upload a completed form for ${currentDept} before marking this form Completed`,
                requiresUpload: true,
                currentStep: currentDept
            });
        }

        const historyAction = isBackwardTransfer ? 'RETURNED' : 'TRANSFERRED';

        // Update form and add history entry
        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                Department: departmentEnum,
                Status: departmentEnum === 'COMPLETED' ? 'APPROVED' : 'PENDING',
                Is_Archived: false,
                History: {
                    create: {
                        Department: departmentEnum,
                        Notes: notes || `${isBackwardTransfer ? 'Returned' : 'Transferred'} to ${departmentEnum}`,
                        Performed_By: req.user.User_ID,
                        Action: historyAction,
                        Reason: String(reason || '').trim() || null
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

        const existingForm = await prisma.form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        if (!isRisFormType(existingForm.Form_Type)) {
            return res.status(400).json({ success: false, error: 'Received indicator is only required for RIS forms' });
        }

        if (!hasVisitedDepartment(existingForm, 'PURCHASING')) {
            return res.status(400).json({
                success: false,
                error: 'RIS form must reach Purchasing before it can be marked received'
            });
        }

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                Is_Received: isReceived,
                Received_At: isReceived ? new Date() : null,
                Received_By: isReceived ? req.user.User_ID : null
            },
            include: formInclude
        });

        if (isReceived) {
            await prisma.formHistory.create({
                data: {
                    Form_ID: formId,
                    Department: form.Department,
                    Notes: `Form marked as received`,
                    Performed_By: req.user.User_ID,
                    Action: 'RECEIVED'
                }
            });
        }

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
        const existingForm = await prisma.form.findUnique({
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

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: {
                ...(shouldSetLegacyFile ? {
                    File_Name: firstAttachment.File_Name,
                    File_URL: firstAttachment.File_URL,
                    File_Type: firstAttachment.File_Type
                } : {}),
                ...(isFormTerminal(existingForm) ? {} : {
                    Status: 'APPROVED',
                    Is_Archived: false
                }),
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

// DELETE /api/forms/:id/attachments/:attachmentId - Remove a form attachment
const deleteFormAttachment = async (req, res) => {
    const formId = parseInt(req.params.id);
    const attachmentId = parseInt(req.params.attachmentId);

    if (isNaN(formId) || isNaN(attachmentId)) {
        return res.status(400).json({ success: false, error: 'Invalid form or attachment ID' });
    }

    try {
        const existingForm = await prisma.form.findUnique({
            where: { Form_ID: formId },
            include: formInclude
        });

        if (!existingForm) {
            return res.status(404).json({ success: false, error: 'Form not found' });
        }

        const attachment = existingForm.Attachments.find(item => item.Attachment_ID === attachmentId);
        if (!attachment) {
            return res.status(404).json({ success: false, error: 'Attachment not found' });
        }

        await prisma.formAttachment.delete({
            where: { Attachment_ID: attachmentId }
        });

        const remainingAttachments = existingForm.Attachments.filter(item => item.Attachment_ID !== attachmentId);
        const nextPrimaryAttachment = remainingAttachments[0];
        const removedLegacyFile = existingForm.File_URL === attachment.File_URL;

        const form = await prisma.form.update({
            where: { Form_ID: formId },
            data: removedLegacyFile ? {
                File_Name: nextPrimaryAttachment?.File_Name || null,
                File_URL: nextPrimaryAttachment?.File_URL || null,
                File_Type: nextPrimaryAttachment?.File_Type || null
            } : {},
            include: formInclude
        });

        await AuditLogger.logForm(
            req.user.User_ID,
            'FORM_ATTACHMENT_REMOVED',
            `Removed attachment from form ${form.Form_Code}`,
            getNotifyRoles(),
            form.Creator_ID
        );

        res.json({ success: true, data: form });
    } catch (error) {
        console.error('Error deleting form attachment:', error);
        res.status(500).json({ success: false, error: 'Failed to delete form attachment' });
    }
};

// DELETE /api/forms/:id - Delete form (hard delete)
const deleteForm = async (req, res) => {
    const formId = parseInt(req.params.id);

    if (isNaN(formId)) {
        return res.status(400).json({ success: false, error: 'Invalid form ID' });
    }

    try {
        await prisma.form.delete({
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
    unarchiveForm,
    transferForm,
    setFormReceived,
    addFormAttachments,
    deleteFormAttachment,
    deleteForm
};
