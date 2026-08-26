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

  async runGMassDiagnostic(req, res) {
    try {
      const GMassClient = require('../../integrations/email/gmass/gmass.client');
      const settingsService = require('../settings/settings.service');
      const db = require('../../config/db');

      const settings = await settingsService.getSettings();
      const apiKey = settings.gmass_api_key || process.env.GMASS_API_KEY;
      const client = new GMassClient(apiKey);

      const report = {
        timestamp: new Date().toISOString(),
        settings: {
          hasApiKey: !!apiKey,
          webhookEnabled: settings.gmass_webhook_enabled,
          pollingEnabled: settings.gmass_polling_enabled,
          webhookSecretConfigured: !!(settings.gmass_webhook_secret || process.env.GMASS_WEBHOOK_SECRET)
        },
        database: {},
        gmassApiTests: {}
      };

      // 1. Test Database Columns
      try {
        const [cols] = await db.query("SHOW COLUMNS FROM email_events LIKE 'event_source'");
        report.database.eventSourceType = cols[0]?.Type || 'unknown';
      } catch (dbErr) {
        report.database.error = dbErr.message;
      }

      // 2. Test GMass API Draft Creation (/api/campaigndrafts)
      try {
        const draftRes = await client.createDraft({
          subject: 'Diagnostic API Test ' + Date.now(),
          message: '<p>Testing GMass API diagnostic endpoint</p>',
          emailAddresses: 'ronitsarkar.dev@gmail.com'
        });
        report.gmassApiTests.createDraft = {
          success: true,
          response: draftRes
        };

        // 3. Test GMass API Campaign Launch (/api/campaigns)
        const draftId = draftRes.campaignDraftId || draftRes.draftId || draftRes.id;
        try {
          const campRes = await client.sendCampaign(draftId, { openTracking: true, clickTracking: true });
          report.gmassApiTests.sendCampaign = {
            success: true,
            response: campRes
          };
        } catch (cErr) {
          report.gmassApiTests.sendCampaign = {
            success: false,
            error: cErr.message,
            statusCode: cErr.statusCode,
            responseBody: cErr.responseBody
          };
        }
      } catch (dErr) {
        report.gmassApiTests.createDraft = {
          success: false,
          error: dErr.message,
          statusCode: dErr.statusCode,
          responseBody: dErr.responseBody
        };
      }

      res.status(200).json(ApiResponse.success(report, 'GMass diagnostic scan executed successfully'));
    } catch (err) {
      console.error('[GMass Diagnostic Error]', err);
      res.status(500).json(ApiResponse.error('DIAGNOSTIC_ERROR', err.message));
    }
  }
}

module.exports = new WebhookController();
