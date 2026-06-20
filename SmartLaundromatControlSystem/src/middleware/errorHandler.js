/**
 * Error Handler Middleware
 * Centralized error handling for Express
 * Provides detailed errors in development, generic errors in production
 */

const config = require('../config/env');

/**
 * Error handler middleware
 * Should be the LAST middleware in the stack
 */
const errorHandler = (err, req, res, next) => {
    // Log the error (always log to console.error for debugging)
    console.error('❌ Error:', {
        message: err.message,
        stack: config.IS_DEVELOPMENT || config.IS_TEST ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Development/Test: Send detailed error information (consistent format)
    if (config.IS_DEVELOPMENT || config.IS_TEST || config.IS_CICD) {
        return res.status(statusCode).json({
            success: false,
            error: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
        });
    }

    // Production: Send generic error message (don't leak stack traces)
    const productionErrors = {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        429: 'Too Many Requests',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable'
    };

    res.status(statusCode).json({
        success: false,
        error: productionErrors[statusCode] || 'An error occurred'
    });
};

/**
 * 404 Not Found handler
 * Should be placed AFTER all routes but BEFORE error handler
 */
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Route not found: ${req.method} ${req.path}`);
    error.statusCode = 404;
    next(error);
};

module.exports = {
    errorHandler,
    notFoundHandler
};
