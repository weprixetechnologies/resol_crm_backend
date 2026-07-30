const ApiResponse = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred';

  // Only log full stack trace for 500 errors to avoid console spam/false alarms on client errors
  if (statusCode >= 500) {
    console.error(`[${req.method}] ${req.originalUrl} - Error:`, err);
  } else {
    console.warn(`[${req.method}] ${req.originalUrl} - ${statusCode}: ${message}`);
  }

  res.status(statusCode).json(ApiResponse.error(errorCode, message));
};

module.exports = errorHandler;
