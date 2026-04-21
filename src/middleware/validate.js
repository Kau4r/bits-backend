/**
 * Input validation schemas and middleware using Joi
 */
const Joi = require('joi');
const { AppError } = require('./errorHandler');

const workflowFormDepartments = [
    'REQUESTOR',
    'DEPARTMENT_HEAD',
    'DEAN_OFFICE',
    'TNS',
    'PURCHASING',
    'PPFO',
    'COMPLETED'
];

// ==================== SCHEMAS ====================

/**
 * Booking validation schemas
 */
const bookingSchemas = {
    create: Joi.object({
        User_ID: Joi.number().integer().positive().required(),
        Room_ID: Joi.number().integer().positive().required(),
        Start_Time: Joi.date().iso().required(),
        End_Time: Joi.date().iso().greater(Joi.ref('Start_Time')).required(),
        Purpose: Joi.string().max(500).allow('', null)
    }),

    updateStatus: Joi.object({
        status: Joi.string().valid('APPROVED', 'REJECTED', 'CANCELLED').required(),
        approverId: Joi.number().integer().positive().required(),
        notes: Joi.string().max(500).allow('', null)
    }),

    update: Joi.object({
        Start_Time: Joi.date().iso(),
        End_Time: Joi.date().iso(),
        Room_ID: Joi.number().integer().positive(),
        Purpose: Joi.string().max(500).allow('', null),
        Notes: Joi.string().max(500).allow('', null)
    }).min(1)
};

/**
 * Ticket validation schemas
 */
const ticketSchemas = {
    create: Joi.object({
        Reported_By_ID: Joi.number().integer().positive().required(),
        Report_Problem: Joi.string().trim().min(1).max(1000).required(),
        Location: Joi.string().max(200).allow('', null),
        Item_ID: Joi.number().integer().positive().allow(null),
        Room_ID: Joi.number().integer().positive().allow(null),
        Status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'RESOLVED').default('PENDING'),
        Priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').allow('', null),
        Category: Joi.string().valid('HARDWARE', 'SOFTWARE', 'FACILITY', 'OTHER').allow('', null)
    }),

    update: Joi.object({
        Status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'RESOLVED'),
        Priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').allow('', null),
        Category: Joi.string().valid('HARDWARE', 'SOFTWARE', 'FACILITY', 'OTHER').allow('', null),
        Archived: Joi.boolean(),
        Technician_ID: Joi.number().integer().positive().allow(null),
        Report_Problem: Joi.string().trim().min(1).max(1000),
        Location: Joi.string().max(200).allow('', null),
        Item_ID: Joi.number().integer().positive().allow(null),
        Room_ID: Joi.number().integer().positive().allow(null)
    }).min(1)
};

/**
 * Room validation schemas
 */
const roomSchemas = {
    create: Joi.object({
        Name: Joi.string().min(1).max(100).required(),
        Room_Type: Joi.string().valid('CONSULTATION', 'CONFERENCE', 'LECTURE', 'LAB').required(),
        Capacity: Joi.number().integer().positive().allow(null),
        Status: Joi.string().valid('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'CLOSED').default('AVAILABLE')
    }),

    update: Joi.object({
        Name: Joi.string().min(1).max(100),
        Room_Type: Joi.string().valid('CONSULTATION', 'CONFERENCE', 'LECTURE', 'LAB'),
        Capacity: Joi.number().integer().positive().allow(null),
        Status: Joi.string().valid('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'CLOSED')
    }).min(1),

    studentAvailability: Joi.object({
        startTime: Joi.date().iso().required(),
        endTime: Joi.date().iso().greater(Joi.ref('startTime')).required()
    })
};

/**
 * Inventory item validation schemas
 */
const inventorySchemas = {
    create: Joi.object({
        User_ID: Joi.number().integer().positive(),
        Item_Code: Joi.string().max(50).allow('', null),
        Item_Type: Joi.string().trim().min(1).max(50).pattern(/^[A-Za-z0-9 _-]+$/).required(),
        Brand: Joi.string().max(100).allow('', null),
        Serial_Number: Joi.string().max(100).allow('', null),
        Status: Joi.string().valid('AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED').default('AVAILABLE'),
        Room_ID: Joi.number().integer().positive().allow(null),
        Item_Name: Joi.string().max(200).allow('', null),
        Description: Joi.string().max(500).allow('', null)
    }),

    update: Joi.object({
        Item_Code: Joi.string().max(50),
        Item_Type: Joi.string().trim().min(1).max(50).pattern(/^[A-Za-z0-9 _-]+$/),
        Brand: Joi.string().max(100).allow('', null),
        Serial_Number: Joi.string().max(100).allow('', null),
        Status: Joi.string().valid('AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED'),
        Room_ID: Joi.number().integer().positive().allow(null),
        Item_Name: Joi.string().max(200).allow('', null),
        Description: Joi.string().max(500).allow('', null)
    }).min(1),

    bulk: Joi.object({
        items: Joi.array().items(Joi.object({
            Item_Type: Joi.string().trim().min(1).max(50).pattern(/^[A-Za-z0-9 _-]+$/).required(),
            Brand: Joi.string().max(100).allow('', null),
            Serial_Number: Joi.string().max(100).allow('', null),
            Status: Joi.string().valid('AVAILABLE', 'BORROWED', 'DEFECTIVE', 'LOST', 'REPLACED').default('AVAILABLE'),
            Room_ID: Joi.number().integer().positive().allow(null),
            Item_Name: Joi.string().max(200).allow('', null)
        })).min(1).required(),
        User_ID: Joi.number().integer().positive()
    })
};

/**
 * Form validation schemas
 */
const formSchemas = {
    attachment: Joi.object({
        fileName: Joi.string().max(255).required(),
        fileUrl: Joi.string().uri().required(),
        fileType: Joi.string().max(50).allow('', null),
        department: Joi.string().valid(...workflowFormDepartments),
        notes: Joi.string().max(500).allow('', null)
    }),

    create: Joi.object({
        creatorId: Joi.number().integer().positive(),
        formType: Joi.string().valid('WRF', 'RIS').required(),
        title: Joi.string().min(1).max(200).allow('', null),
        content: Joi.string().allow('', null),
        fileName: Joi.string().max(255).allow('', null),
        fileUrl: Joi.string().uri().allow('', null),
        fileType: Joi.string().max(50).allow('', null),
        attachments: Joi.array().items(Joi.object({
            fileName: Joi.string().max(255).required(),
            fileUrl: Joi.string().uri().required(),
            fileType: Joi.string().max(50).allow('', null),
            department: Joi.string().valid(...workflowFormDepartments),
            documentType: Joi.string().valid('INITIAL', 'PURCHASE_ORDER', 'DELIVERY_RECEIPT', 'RECEIVING_REPORT', 'SALES_INVOICE', 'PROOF', 'OTHER'),
            notes: Joi.string().max(500).allow('', null)
        })),
        department: Joi.string().valid(...workflowFormDepartments).default('REQUESTOR'),
        requesterName: Joi.string().max(200).allow('', null),
        remarks: Joi.string().max(1000).allow('', null)
    }),

    update: Joi.object({
        status: Joi.string().valid('PENDING', 'IN_REVIEW', 'APPROVED', 'CANCELLED'),
        approverId: Joi.number().integer().positive(),
        title: Joi.string().min(1).max(200),
        content: Joi.string().allow('', null),
        requesterName: Joi.string().max(200).allow('', null),
        remarks: Joi.string().max(1000).allow('', null)
    }).min(1),

    transfer: Joi.object({
        department: Joi.string().valid(...workflowFormDepartments).required(),
        notes: Joi.string().max(500).allow('', null),
        reason: Joi.string().trim().max(500).allow('', null)
    })
};

/**
 * User/Auth validation schemas
 */
const authSchemas = {
    login: Joi.object({
        username: Joi.string().min(1),
        email: Joi.string().email(),
        password: Joi.string().min(1).required()
    }).or('username', 'email'),

    register: Joi.object({
        Username: Joi.string().min(1).max(50),
        Email: Joi.string().email().required(),
        Password: Joi.string().min(8),
        First_Name: Joi.string().min(1).max(50).required(),
        Last_Name: Joi.string().min(1).max(50).required(),
        User_Role: Joi.string().valid('ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'STUDENT', 'SECRETARY').default('STUDENT')
    })
};

/**
 * Common ID parameter schema
 */
const idParamSchema = Joi.object({
    id: Joi.number().integer().positive().required()
});

// ==================== MIDDLEWARE ====================

/**
 * Validation middleware factory
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {string} property - Property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
const validate = (schema, property = 'body') => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const details = error.details.map(d => d.message).join(', ');
            return next(new AppError(`Validation error: ${details}`, 400, error.details));
        }

        // Replace with validated/sanitized values
        req[property] = value;
        next();
    };
};

/**
 * Validate ID parameter middleware
 */
const validateId = validate(idParamSchema, 'params');

module.exports = {
    // Schemas
    bookingSchemas,
    ticketSchemas,
    roomSchemas,
    inventorySchemas,
    formSchemas,
    authSchemas,
    idParamSchema,

    // Middleware
    validate,
    validateId
};
