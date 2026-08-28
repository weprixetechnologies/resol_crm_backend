const express = require('express');
const settingsController = require('./settings.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const wipeController = require('./wipe.controller');

const router = express.Router();

router.use(authMiddleware);

// All staff can read settings, only admin can update
router.get('/', asyncHandler(settingsController.getSettings));
router.patch('/', requireRole('admin'), asyncHandler(settingsController.updateSettings));
router.post('/test-smtp-connection', requireRole('admin'), asyncHandler(settingsController.testSmtpConnection));
router.post('/test-smtp', requireRole('admin'), asyncHandler(settingsController.testSmtpConnection));
router.post('/test-msg91-connection', requireRole('admin'), asyncHandler(settingsController.testMsg91Connection));
router.post('/test-msg91', requireRole('admin'), asyncHandler(settingsController.testMsg91Connection));

// Destructive Reset Endpoints (Admin only)
router.post('/verify-portal-password', requireRole('admin'), asyncHandler(wipeController.verifyPassword));
router.patch('/portal-password', requireRole('admin'), asyncHandler(wipeController.changePassword));
router.post('/wipe-users', requireRole('admin'), asyncHandler(wipeController.wipeUsers));
router.post('/wipe-staff', requireRole('admin'), asyncHandler(wipeController.wipeStaff));

module.exports = router;
