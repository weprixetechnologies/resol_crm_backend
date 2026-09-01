const express = require('express');
const webhookController = require('./webhook.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// MSG91 Email Webhook Callback Endpoints
router.post('/msg91/email/enqueued', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email/report', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email/activity', asyncHandler(webhookController.handleMsg91EmailWebhook));
router.post('/msg91/email', asyncHandler(webhookController.handleMsg91EmailWebhook));

// MSG91 Incoming Email Replies Webhook Endpoint
router.post('/msg91/incoming-email', asyncHandler(webhookController.handleMsg91IncomingEmail));
router.post('/msg91/incoming', asyncHandler(webhookController.handleMsg91IncomingEmail));

module.exports = router;
