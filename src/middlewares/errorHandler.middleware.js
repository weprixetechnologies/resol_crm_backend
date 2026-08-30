const ApiResponse = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred';

  // Attach open CORS headers on error responses
  const origin = req.headers?.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Only log full stack trace for 500 errors to avoid console spam/false alarms on client errors
  if (statusCode >= 500) {
    console.error(`[${req.method}] ${req.originalUrl} - Error:`, err);
  } else {
    console.warn(`[${req.method}] ${req.originalUrl} - ${statusCode}: ${message}`);
  }

  res.status(statusCode).json(ApiResponse.error(errorCode, message));
};

module.exports = errorHandler;
