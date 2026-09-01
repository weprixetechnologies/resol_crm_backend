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
router.post('/templates/sync', requireRole('admin'), mailController.syncAllTemplatesToMsg91);
router.post('/templates/sync-all-msg91', requireRole('admin'), mailController.syncAllTemplatesToMsg91);
router.post('/templates/:id/sync-msg91', requireRole('admin'), mailController.syncTemplateToMsg91);
router.get('/templates/versions/:versionId', requireRole('admin'), mailController.getTemplateVersionDetails);
router.get('/templates/:crmTemplateId/status', mailController.getTemplateStatus);
router.get('/templates/:id/status', mailController.getTemplateStatus);
router.get('/templates/:id', mailController.getTemplateById);
router.post('/templates', requireRole('admin'), mailController.createTemplate);
router.put('/templates/:id', requireRole('admin'), mailController.updateTemplate);
router.delete('/templates/:id', requireRole('admin'), mailController.deleteTemplate);

// Send Mail
router.post('/send', mailController.sendMail);

// BullMQ Queue Status
router.get('/queue-status', mailController.getQueueStatus);

// Email Analytics API (PART 3)
router.get('/analytics', mailController.getAnalytics);

// Email Delivery Logs & Per-Recipient Journey (PART 18 & 19)
router.get('/logs', mailController.getLogs);
router.get('/inbound-replies', mailController.getInboundReplies);
router.get('/conversations/:id/messages', mailController.getConversationMessages);
router.post('/logs/bulk-request-deletion', mailController.bulkRequestDeletion);
router.get('/logs/:id', mailController.getLogJourney);

// Log Reconciliation API (PART 20)
router.post('/reconcile-logs', requireRole('admin'), mailController.reconcileMsg91Logs);

// Permanent CRM Email Bounces & Suppression API (PART 11 & PART 13)
router.get('/bounces', mailController.getBounces);
router.delete('/bounces/:id/contact', requireRole('admin'), mailController.deleteBouncedContact);

// Legacy aliases for backwards compatibility
router.get('/msg91-logs', requireRole('admin'), mailController.getMsg91Logs);
router.get('/msg91-analytics', mailController.getAnalytics);

module.exports = router;
