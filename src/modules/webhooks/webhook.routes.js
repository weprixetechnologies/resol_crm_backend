const express = require('express');
const webhookController = require('./webhook.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// MSG91 Email Webhook Callback Endpoints (PART 6)
router.post('/msg91/email/enqueued', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email/report', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email/activity', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email', asyncHandler(webhookController.handleMsg91EmailWebhook));

module.exports = router;
