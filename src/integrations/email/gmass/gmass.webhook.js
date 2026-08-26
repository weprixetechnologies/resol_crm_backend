const db = require('../../../config/db');
const env = require('../../../config/env');
const { normalizeWebhookPayload } = require('./gmass.types');
const auditService = require('../../../modules/audit/audit.service');
const settingsService = require('../../../modules/settings/settings.service');

class GMassWebhookProcessor {
  /**
   * Main entry point for processing incoming webhook payloads from GMass.
   * @param {Object} rawBody - Raw body parsed from express.json()
   * @param {Object} queryParams - Query parameters from req.query
   * @param {Object} headers - HTTP headers from req.headers
   * @returns {Promise<Object>} Processing result summary
   */
  async processEvent(rawBody, queryParams = {}, headers = {}) {
    const settings = await settingsService.getSettings();

    // Check if webhooks are toggled active (defaults to true if not explicitly disabled)
    if (settings.gmass_webhook_enabled === false || settings.gmass_webhook_enabled === 'false') {
      console.log('[GMass Webhook] Webhooks are currently toggled INACTIVE in System Settings. Event ignored.');
      return { success: false, message: 'GMass webhooks are currently disabled in CRM System Settings' };
    }

    // 1. Secret verification (if secret configured)
    const activeSecret = settings.gmass_webhook_secret || env.GMASS_WEBHOOK_SECRET;
    if (activeSecret) {
      const providedSecret = queryParams.secret || queryParams.token || headers['x-gmass-webhook-secret'] || headers['x-webhook-secret'];
      if (providedSecret !== activeSecret) {
        const err = new Error('Unauthorized GMass webhook request: Invalid secret key');
        err.statusCode = 401;
        throw err;
      }
    }

    // 2. Defensive Payload Normalization
    const event = normalizeWebhookPayload(rawBody);
    const { campaignId, email, eventType, eventAt, link, bounceReason, raw } = event;

    if (!email) {
      console.warn('[GMass Webhook] Warning: Webhook payload missing recipient email address. Raw:', JSON.stringify(raw));
      return { success: false, message: 'Missing recipient email address' };
    }

    // 3. Find associated contact in `users` table
    const [[contact]] = await db.query(
      'SELECT id, name, email, lead_status, is_opted_out, email_invalid FROM users WHERE email_normalized = ? OR email = ? LIMIT 1',
      [email.toLowerCase(), email]
    );

    const contactId = contact ? contact.id : null;

    // 4. Find internal `email_campaigns` record if campaignId is present
    let internalCampaignId = null;
    if (campaignId) {
      const [[camp]] = await db.query(
        'SELECT id FROM email_campaigns WHERE gmass_campaign_id = ? OR gmass_draft_id = ? OR id = ? LIMIT 1',
        [campaignId, campaignId, campaignId]
      );
      if (camp) internalCampaignId = camp.id;
    }

    // 5. Insert event into `email_events` with idempotency check
    const formattedEventAt = new Date(eventAt).toISOString().slice(0, 19).replace('T', ' ');
    const rawPayloadJson = JSON.stringify(raw);

    try {
      await db.query(
        `INSERT INTO email_events (campaign_id, contact_id, recipient_email, event_type, event_source, raw_payload, event_at)
         VALUES (?, ?, ?, ?, 'webhook', ?, ?)
         ON DUPLICATE KEY UPDATE raw_payload = VALUES(raw_payload)`,
        [internalCampaignId, contactId, email, eventType, rawPayloadJson, formattedEventAt]
      );
    } catch (err) {
      console.warn('[GMass Webhook] Duplicate event or insertion warning:', err.message);
    }

    // 6. Update `campaign_recipients` status & timestamps if campaign record exists
    if (internalCampaignId) {
      await this.updateCampaignRecipient(internalCampaignId, email, eventType, formattedEventAt);
    }

    // 7. Update CRM Lead / Contact status in `users` table if contact exists
    if (contactId) {
      await this.applyLeadStatusAutomation(contact, eventType, formattedEventAt, link, bounceReason, internalCampaignId);
    }

    // Log audit entry
    await auditService.log({
      actorId: null,
      actorRole: 'system',
      action: `GMASS_WEBHOOK_${eventType.toUpperCase()}`,
      entityType: 'email_event',
      meta: { email, campaignId, eventType, contactId }
    });

    return {
      success: true,
      email,
      eventType,
      contactId,
      campaignId: internalCampaignId
    };
  }

  /**
   * Update recipient status in `campaign_recipients`
   */
  async updateCampaignRecipient(campaignId, email, eventType, eventAt) {
    const statusMap = {
      'Send': 'sent',
      'Open': 'opened',
      'Click': 'clicked',
      'Reply': 'replied',
      'Bounce': 'bounced',
      'Unsubscribe': 'unsubscribed'
    };

    const recipientStatus = statusMap[eventType] || 'sent';

    let updateField = '';
    if (eventType === 'Send') updateField = 'sent_at = COALESCE(sent_at, ?)';
    else if (eventType === 'Open') updateField = 'opened_at = COALESCE(opened_at, ?)';
    else if (eventType === 'Click') updateField = 'clicked_at = COALESCE(clicked_at, ?)';
    else if (eventType === 'Reply') updateField = 'replied_at = COALESCE(replied_at, ?)';
    else if (eventType === 'Bounce') updateField = 'bounced_at = COALESCE(bounced_at, ?)';
    else if (eventType === 'Unsubscribe') updateField = 'unsubscribed_at = COALESCE(unsubscribed_at, ?)';

    if (updateField) {
      await db.query(
        `UPDATE campaign_recipients 
         SET status = ?, ${updateField}, updated_at = NOW()
         WHERE campaign_id = ? AND LOWER(email_address) = ?`,
        [recipientStatus, eventAt, campaignId, email.toLowerCase()]
      );
    }
  }

  /**
   * Apply status state-machine transitions to `users` lead record
   */
  async applyLeadStatusAutomation(contact, eventType, eventAt, link, bounceReason, campaignId) {
    const currentStatus = contact.lead_status || 'New';
    let newStatus = currentStatus;

    if (eventType === 'Open') {
      // Don't downgrade if already Hot Lead or Conversation Started
      if (!['Hot Lead', 'Conversation Started'].includes(currentStatus)) {
        newStatus = 'Engaged';
      }
    } else if (eventType === 'Click') {
      // Don't downgrade if Conversation Started
      if (currentStatus !== 'Conversation Started') {
        newStatus = 'Hot Lead';
      }
    } else if (eventType === 'Reply') {
      newStatus = 'Conversation Started';
      
      // Stop automated follow-ups & log remark
      await db.query(
        `UPDATE users SET stop_automated_followups = 1 WHERE id = ?`,
        [contact.id]
      );

      const remarkText = `[GMass Campaign ${campaignId || ''} Reply Received]: Recipient replied on ${eventAt}`;
      await db.query(
        `INSERT INTO user_queries (user_id, remark, source, created_by) VALUES (?, ?, 'staff_remark', NULL)`,
        [contact.id, remarkText]
      );
    } else if (eventType === 'Bounce') {
      newStatus = 'Invalid Email';
      await db.query(
        `UPDATE users SET email_invalid = 1 WHERE id = ?`,
        [contact.id]
      );
    } else if (eventType === 'Unsubscribe') {
      newStatus = 'Opted Out';
      await db.query(
        `UPDATE users SET is_opted_out = 1 WHERE id = ?`,
        [contact.id]
      );
    }

    if (newStatus !== currentStatus) {
      await db.query(
        `UPDATE users SET lead_status = ?, updated_at = NOW() WHERE id = ?`,
        [newStatus, contact.id]
      );
    }
  }
}

module.exports = new GMassWebhookProcessor();
