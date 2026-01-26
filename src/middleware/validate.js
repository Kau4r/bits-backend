/**
 * Input validation schemas and middleware using Joi
 */
const Joi = require('joi');
const { AppError } = require('./errorHandler');

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
        Report_Problem: Joi.string().min(5).max(1000).required(),
        Location: Joi.string().max(200).allow('', null),
        Item_ID: Joi.number().integer().positive().allow(null),
        Room_ID: Joi.number().integer().positive().allow(null),
        Status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'RESOLVED').default('PENDING'),
        Priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').allow(null),
        Category: Joi.string().max(100).allow('', null)
    }),

    update: Joi.object({
        Status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'RESOLVED'),
        Priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
        Category: Joi.string().max(100).allow('', null),
        Archived: Joi.boolean(),
        Technician_ID: Joi.number().integer().positive().allow(null)
    }).min(1)
};

/**
 * Room validation schemas
 */
const roomSchemas = {
    create: Joi.object({
        Name: Joi.string().min(1).max(100).required(),
        Room_Type: Joi.string().valid('LAB', 'CLASSROOM', 'OFFICE', 'STORAGE').required(),
        Capacity: Joi.number().integer().positive().allow(null),
        Status: Joi.string().valid('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'CLOSED').default('AVAILABLE')
    }),

    update: Joi.object({
        Name: Joi.string().min(1).max(100),
        Room_Type: Joi.string().valid('LAB', 'CLASSROOM', 'OFFICE', 'STORAGE'),
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
        Item_Type: Joi.string().valid('GENERAL', 'COMPUTER', 'EQUIPMENT', 'FURNITURE', 'CONSUMABLE').required(),
        Brand: Joi.string().max(100).allow('', null),
        Serial_Number: Joi.string().max(100).allow('', null),
        Status: Joi.string().valid('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED').default('AVAILABLE'),
        Room_ID: Joi.number().integer().positive().allow(null),
        Item_Name: Joi.string().max(200).allow('', null),
        Description: Joi.string().max(500).allow('', null)
    }),

    update: Joi.object({
        Item_Code: Joi.string().max(50),
        Item_Type: Joi.string().valid('GENERAL', 'COMPUTER', 'EQUIPMENT', 'FURNITURE', 'CONSUMABLE'),
        Brand: Joi.string().max(100).allow('', null),
        Serial_Number: Joi.string().max(100).allow('', null),
        Status: Joi.string().valid('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'),
        Room_ID: Joi.number().integer().positive().allow(null),
        Item_Name: Joi.string().max(200).allow('', null),
        Description: Joi.string().max(500).allow('', null)
    }).min(1),

    bulk: Joi.object({
        items: Joi.array().items(Joi.object({
            Item_Type: Joi.string().valid('GENERAL', 'COMPUTER', 'EQUIPMENT', 'FURNITURE', 'CONSUMABLE').required(),
            Brand: Joi.string().max(100).allow('', null),
            Serial_Number: Joi.string().max(100).allow('', null),
            Status: Joi.string().valid('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED').default('AVAILABLE'),
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
    create: Joi.object({
        creatorId: Joi.number().integer().positive(),
        formType: Joi.string().valid('WRF', 'JO', 'ICL', 'PPE', 'MRIS', 'TRANSFER').required(),
        title: Joi.string().min(1).max(200).required(),
        content: Joi.string().allow('', null),
        fileName: Joi.string().max(255).allow('', null),
        fileUrl: Joi.string().uri().allow('', null),
        fileType: Joi.string().max(50).allow('', null),
        department: Joi.string().valid('REGISTRAR', 'ADMIN', 'IT', 'HR', 'FINANCE').default('REGISTRAR')
    }),

    update: Joi.object({
        status: Joi.string().valid('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'ARCHIVED'),
        approverId: Joi.number().integer().positive(),
        title: Joi.string().min(1).max(200),
        content: Joi.string().allow('', null)
    }).min(1),

    transfer: Joi.object({
        targetDepartment: Joi.string().valid('REGISTRAR', 'ADMIN', 'IT', 'HR', 'FINANCE').required(),
        notes: Joi.string().max(500).allow('', null)
    })
};

/**
 * User/Auth validation schemas
 */
const authSchemas = {
    login: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(1).required()
    }),

    register: Joi.object({
        Email: Joi.string().email().required(),
        Password: Joi.string().min(8).required(),
        First_Name: Joi.string().min(1).max(50).required(),
        Last_Name: Joi.string().min(1).max(50).required(),
        User_Role: Joi.string().valid('ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'STUDENT').default('STUDENT')
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
