const express = require('express');
const dashboardController = require('./dashboard.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Both Admin and Staff can see stats
router.get('/stats', asyncHandler(dashboardController.getStats));

// Only Admin can see audit logs
router.get('/audit-logs', requireRole('admin'), asyncHandler(dashboardController.getAuditLogs));

module.exports = router;
