const db = require('../config/db');
const env = require('../config/env');
const GMassClient = require('../integrations/email/gmass/gmass.client');
const gmassWebhookProcessor = require('../integrations/email/gmass/gmass.webhook');
const settingsService = require('../modules/settings/settings.service');

class GMassReconciliationJob {
  constructor() {
    this.client = new GMassClient();
    this.timer = null;
  }

  /**
   * Run one iteration of GMass polling reconciliation
   */
  async runReconciliation() {
    const settings = await settingsService.getSettings();

    if (settings.gmass_polling_enabled === false || settings.gmass_polling_enabled === 'false') {
      console.log('[GMass Polling Job] Background polling is currently toggled INACTIVE in System Settings. Skipping.');
      return;
    }

    console.log('[GMass Polling Job] Starting campaign event reconciliation scan...');
    try {
      // Find campaigns sent within last 30 days that have a gmass_campaign_id
      const [campaigns] = await db.query(
        `SELECT id, name, gmass_campaign_id, created_at
         FROM email_campaigns
         WHERE status = 'sent' AND gmass_campaign_id IS NOT NULL AND gmass_campaign_id != '' AND gmass_campaign_id NOT LIKE 'cmp_%'
           AND created_at >= NOW() - INTERVAL 30 DAY`
      );

      console.log(`[GMass Polling Job] Found ${campaigns.length} active campaign(s) to reconcile.`);

      let reconciledEventsCount = 0;

      for (const campaign of campaigns) {
        const campaignId = campaign.gmass_campaign_id;

        // Fetch reports for all event types from GMass
        const reportTypes = [
          { type: 'Open', fetchFn: () => this.client.getOpens(campaignId) },
          { type: 'Click', fetchFn: () => this.client.getClicks(campaignId) },
          { type: 'Reply', fetchFn: () => this.client.getReplies(campaignId) },
          { type: 'Bounce', fetchFn: () => this.client.getBounces(campaignId) },
          { type: 'Unsubscribe', fetchFn: () => this.client.getUnsubscribes(campaignId) }
        ];

        for (const report of reportTypes) {
          try {
            const data = await report.fetchFn();
            const items = Array.isArray(data) ? data : (data.results || data.items || data.data || []);

            for (const rawItem of items) {
              // Ensure campaignId is present in item
              rawItem.campaignId = rawItem.campaignId || campaignId;
              rawItem.eventType = rawItem.eventType || report.type;

              const result = await gmassWebhookProcessor.processEvent(rawItem);
              if (result.success) reconciledEventsCount++;
            }
          } catch (err) {
            console.warn(`[GMass Polling Job] Error fetching ${report.type} report for campaign ${campaignId}:`, err.message);
          }
        }
      }

      console.log(`[GMass Polling Job] Reconciliation finished. Total events processed/reconciled: ${reconciledEventsCount}`);
    } catch (err) {
      console.error('[GMass Polling Job] Error running reconciliation scan:', err);
    }
  }

  /**
   * Start recurring timer for polling
   */
  start(intervalMinutes = null) {
    const minutes = intervalMinutes || env.GMASS_POLL_INTERVAL_MINUTES || 15;
    const intervalMs = minutes * 60 * 1000;

    console.log(`[GMass Polling Job] Initializing background polling every ${minutes} minute(s)...`);
    
    // Initial run after short delay
    setTimeout(() => this.runReconciliation(), 5000);

    // Interval schedule
    this.timer = setInterval(() => this.runReconciliation(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[GMass Polling Job] Polling stopped.');
    }
  }
}

module.exports = new GMassReconciliationJob();
