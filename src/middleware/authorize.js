/**
 * Authorization middleware for role-based access control
 */
const { AppError } = require('./errorHandler');

/**
 * Middleware to check if user has one of the allowed roles
 * @param  {...string} allowedRoles - Roles that are allowed to access the route
 * @returns {Function} Express middleware
 */
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(new AppError('Authentication required', 401));
        }

        // Normalize role names (handle both LAB_HEAD and LABHEAD formats)
        const normalizedRole = req.user.User_Role.replace(/([A-Z])([A-Z]+)/g, '$1_$2').toUpperCase();
        const normalizedAllowedRoles = allowedRoles.map(role =>
            role.replace(/([A-Z])([A-Z]+)/g, '$1_$2').toUpperCase()
        );

        if (!normalizedAllowedRoles.includes(normalizedRole) &&
            !allowedRoles.includes(req.user.User_Role)) {
            return next(new AppError('You do not have permission to perform this action', 403));
        }

        next();
    };
};

/**
 * Predefined role groups for common access patterns
 */
const ROLES = {
    ADMIN: ['ADMIN'],
    LAB_STAFF: ['ADMIN', 'LAB_HEAD', 'LAB_TECH', 'LABHEAD', 'LABTECH'],
    LAB_MANAGEMENT: ['ADMIN', 'LAB_HEAD', 'LABHEAD'],
    ALL_USERS: ['ADMIN', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'STUDENT', 'LABHEAD', 'LABTECH']
};

module.exports = {
    authorize,
    ROLES
};
