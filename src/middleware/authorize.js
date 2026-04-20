/**
 * Authorization middleware for role-based access control
 */
const { AppError } = require('./errorHandler');

const ROLE_ALIASES = {
    ADMIN: 'ADMIN',
    LAB_TECH: 'LAB_TECH',
    LABTECH: 'LAB_TECH',
    LAB_HEAD: 'LAB_HEAD',
    LABHEAD: 'LAB_HEAD',
    FACULTY: 'FACULTY',
    SECRETARY: 'SECRETARY',
    STUDENT: 'STUDENT',
};

const normalizeRole = (role) => {
    if (!role) return null;
    const normalized = String(role).trim().toUpperCase().replace(/[\s-]+/g, '_');
    return ROLE_ALIASES[normalized] || null;
};

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

        const normalizedRole = normalizeRole(req.user.User_Role);
        const normalizedAllowedRoles = allowedRoles.flat().map(normalizeRole).filter(Boolean);

        if (!normalizedRole || !normalizedAllowedRoles.includes(normalizedRole)) {
            return next(new AppError('You do not have permission to perform this action', 403));
        }

        next();
    };
};

/**
 * Predefined role groups for common access patterns
 */
const ROLES = {
    ADMIN: 'ADMIN',
    SECRETARY: 'SECRETARY',
    LAB_HEAD: 'LAB_HEAD',
    LAB_TECH: 'LAB_TECH',
    FACULTY: 'FACULTY',
    STUDENT: 'STUDENT',
    LAB_STAFF: ['ADMIN', 'SECRETARY', 'LAB_HEAD', 'LAB_TECH', 'LABHEAD', 'LABTECH'],
    LAB_MANAGEMENT: ['ADMIN', 'SECRETARY', 'LAB_HEAD', 'LABHEAD'],
    ALL_USERS: ['ADMIN', 'SECRETARY', 'LAB_HEAD', 'LAB_TECH', 'FACULTY', 'STUDENT', 'LABHEAD', 'LABTECH']
};

module.exports = {
    authorize,
    ROLES,
    normalizeRole
};
