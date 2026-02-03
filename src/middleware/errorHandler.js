/**
 * Centralized error handler middleware
 */
class AppError extends Error {
    constructor(message, statusCode, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
    // Default values
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal server error';
    let details = err.details || null;

    // Prisma errors
    if (err.code) {
        switch (err.code) {
            case 'P2002':
                statusCode = 409;
                message = 'A record with this value already exists';
                details = err.meta?.target;
                break;
            case 'P2025':
                statusCode = 404;
                message = 'Record not found';
                break;
            case 'P2003':
                statusCode = 400;
                message = 'Invalid reference - related record not found';
                break;
        }
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
    }
    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
    }

    // Log error (but not user errors)
    if (statusCode >= 500) {
        console.error('[Error]', {
            message: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method
        });
    }

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(details && { details }),
        ...(process.env.NODE_ENV === 'development' && statusCode >= 500 && { stack: err.stack })
    });
};

/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res, next) => {
    next(new AppError(`Route ${req.originalUrl} not found`, 404));
};

module.exports = {
    AppError,
    asyncHandler,
    errorHandler,
    notFoundHandler
};
