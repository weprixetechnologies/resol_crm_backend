const gmassWebhookProcessor = require('../../integrations/email/gmass/gmass.webhook');
const ApiResponse = require('../../utils/apiResponse');

class WebhookController {
  async handleGMassWebhook(req, res) {
    try {
      const eventTypeParam = req.params.eventType;
      const rawPayload = { ...(req.query || {}), ...(req.body || {}) };

      // Inject eventType into payload if provided in URL parameter
      if (eventTypeParam && !rawPayload.event && !rawPayload.eventType) {
        rawPayload.eventType = eventTypeParam;
      }

      const result = await gmassWebhookProcessor.processEvent(rawPayload, req.query, req.headers);
      
      // Respond 200 OK so GMass knows event was successfully received
      res.status(200).json(ApiResponse.success(result, 'GMass event processed successfully'));
    } catch (err) {
      console.error('[GMass Webhook Error]', err);
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json(ApiResponse.error('WEBHOOK_ERROR', err.message));
    }
  }
}

module.exports = new WebhookController();
