const express = require('express');
const userController = require('./user.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.use(authMiddleware);

// Both staff and admin can access these (actions scoped in service)
router.post('/', asyncHandler(userController.createUser));
router.get('/', asyncHandler(userController.getUsers));
router.get('/export', asyncHandler(userController.exportUsers));
router.get('/:id', asyncHandler(userController.getUserById));
router.patch('/:id', asyncHandler(userController.updateUser));
router.put('/:id', asyncHandler(userController.updateUser));

// Request deletion (usually staff, but admin can also do it directly or delete via another endpoint later)
router.post('/bulk-request-deletion', asyncHandler(userController.bulkRequestDeletion));
router.post('/:id/request-deletion', asyncHandler(userController.requestDeletion));

// Add remark manually
router.post('/:id/remarks', asyncHandler(userController.addRemark));

// Sync serial numbers
router.post('/sync-serial', requireRole(['admin']), asyncHandler(userController.syncSerialNumbers));

// MSG91 Email Validation
router.post('/bulk-validate-email', asyncHandler(userController.bulkValidateEmails));
router.post('/:id/validate-email', asyncHandler(userController.validateEmail));

// Email Activity History
router.get('/:id/email-activity', asyncHandler(userController.getEmailActivity));

module.exports = router;
