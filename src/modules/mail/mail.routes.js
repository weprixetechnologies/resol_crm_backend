const express = require('express');
const router = express.Router();
const mailController = require('./mail.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');

router.use(authMiddleware);

// Test SMTP connection (Admin only)
router.post('/test-connection', requireRole('admin'), mailController.testConnection);
router.post('/test-smtp-connection', requireRole('admin'), mailController.testConnection);

// Email templates CRUD & MSG91 Sync
router.get('/templates', mailController.getTemplates);
router.get('/templates/msg91-live', requireRole('admin'), mailController.getMsg91TemplatesLive);
router.post('/templates/sync-all-msg91', requireRole('admin'), mailController.syncAllTemplatesToMsg91);
router.post('/templates/:id/sync-msg91', requireRole('admin'), mailController.syncTemplateToMsg91);
router.get('/templates/:id', mailController.getTemplateById);
router.post('/templates', requireRole('admin'), mailController.createTemplate);
router.put('/templates/:id', requireRole('admin'), mailController.updateTemplate);
router.delete('/templates/:id', requireRole('admin'), mailController.deleteTemplate);

// Send Mail
router.post('/send', mailController.sendMail);

// BullMQ Queue Status
router.get('/queue-status', mailController.getQueueStatus);

// Email Delivery Logs & MSG91 Live Logs & Analytics
router.get('/logs', mailController.getLogs);
router.get('/msg91-logs', requireRole('admin'), mailController.getMsg91Logs);
router.get('/msg91-analytics', requireRole('admin'), mailController.getMsg91Analytics);

module.exports = router;
