const express = require('express');
const webhookController = require('./webhook.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// MSG91 Email Webhook Callback Endpoint
router.post('/msg91/email', asyncHandler(webhookController.handleMsg91EmailWebhook));

module.exports = router;
