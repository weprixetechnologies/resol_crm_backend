const express = require('express');
const router = express.Router();
const webhookController = require('./webhook.controller');

// GMass Webhook handlers (Public routes - accepts GET, POST, or JSON)
router.all('/gmass-diagnostic', (req, res, next) => webhookController.runGMassDiagnostic(req, res, next));
router.all('/gmass', (req, res, next) => webhookController.handleGMassWebhook(req, res, next));
router.all('/gmass/:eventType', (req, res, next) => webhookController.handleGMassWebhook(req, res, next));

module.exports = router;
