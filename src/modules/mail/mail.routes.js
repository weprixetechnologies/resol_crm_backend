const express = require('express');
const router = express.Router();
const mailController = require('./mail.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');

router.use(authMiddleware);

// Test SMTP connection (Admin only)
router.post('/test-connection', requireRole('admin'), mailController.testConnection);
router.post('/test-gmass-connection', requireRole('admin'), mailController.testGMassConnection);

// Email templates CRUD
router.get('/templates', mailController.getTemplates);
router.get('/templates/:id', mailController.getTemplateById);
router.post('/templates', requireRole('admin'), mailController.createTemplate);
router.put('/templates/:id', requireRole('admin'), mailController.updateTemplate);
router.delete('/templates/:id', requireRole('admin'), mailController.deleteTemplate);

// Send Mail
router.post('/send', mailController.sendMail);

// BullMQ Queue Status
router.get('/queue-status', mailController.getQueueStatus);

// Email Delivery Logs
router.get('/logs', mailController.getLogs);

module.exports = router;
