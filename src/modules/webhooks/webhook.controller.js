const webhookService = require('./webhook.service');
const incomingEmailService = require('./incomingEmail.service');
const ApiResponse = require('../../utils/apiResponse');

class WebhookController {
  async handleMsg91EmailWebhook(req, res) {
    // 1. Verify Secret synchronously if configured
    try {
      await webhookService.verifySecret(req.headers);
    } catch (err) {
      if (err.statusCode === 401) {
        return res.status(401).json(ApiResponse.error('UNAUTHORIZED', err.message));
      }
      return res.status(400).json(ApiResponse.error('BAD_REQUEST', err.message));
    }

    // 2. Immediately respond HTTP 200 OK to MSG91
    res.status(200).json({ success: true });

    // 3. Process webhook event asynchronously without blocking response
    setImmediate(async () => {
      try {
        await webhookService.processEmailWebhook(req.body, req.headers);
      } catch (err) {
        console.error('[MSG91_EMAIL_WEBHOOK_FAILED] Error processing webhook:', err.message, err.stack);
      }
    });
  }

  /**
   * Endpoint Handler for MSG91 Incoming Email Replies: POST /api/webhooks/msg91/incoming-email
   */
  async handleMsg91IncomingEmail(req, res) {
    try {
      await incomingEmailService.verifySecret(req.headers, req.query);
    } catch (err) {
      if (err.statusCode === 401) {
        return res.status(401).json(ApiResponse.error('UNAUTHORIZED', err.message));
      }
      return res.status(400).json(ApiResponse.error('BAD_REQUEST', err.message));
    }

    // Immediately respond HTTP 200 OK to MSG91
    res.status(200).json({ success: true, message: 'Incoming email payload received' });

    // Process incoming email asynchronously
    setImmediate(async () => {
      try {
        await incomingEmailService.processIncomingReply(req.body, req.headers, req.query);
      } catch (err) {
        console.error('[MSG91_INCOMING_EMAIL_FAILED] Error processing incoming reply:', err.message, err.stack);
      }
    });
  }
}

module.exports = new WebhookController();
