const crypto = require('crypto');
const db = require('../../config/db');
const settingsService = require('../settings/settings.service');

// Status rank hierarchy for non-downgrade logic
const STATUS_RANK = {
  QUEUED: 1,
  ACCEPTED: 2,
  DELIVERED: 3,
  OPENED: 4,
  CLICKED: 5,
  FAILED: 6,
  UNSUBSCRIBED: 6,
  COMPLAINT: 6
};

class WebhookService {
  /**
   * Safely parse a value that might be stringified JSON or an object/array
   */
  safeParseJson(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return val;
        }
      }
    }
    return val;
  }

  /**
   * Normalize MSG91 event names to standard CRM status string
   */
  normalizeEventName(eventName) {
    if (!eventName) return 'QUEUED';
    const lower = eventName.toString().trim().toLowerCase();

    if (lower.includes('queue')) return 'QUEUED';
    if (lower.includes('accept')) return 'ACCEPTED';
    if (lower.includes('deliver')) return 'DELIVERED';
    if (lower.includes('open')) return 'OPENED';
    if (lower.includes('click')) return 'CLICKED';
    if (lower.includes('unsub')) return 'UNSUBSCRIBED';
    if (lower.includes('complaint') || lower.includes('spam')) return 'COMPLAINT';
    if (lower.includes('fail') || lower.includes('bounce') || lower.includes('reject')) return 'FAILED';

    return eventName.toUpperCase();
  }

  /**
   * Check if current status should be updated based on status rank hierarchy
   */
  shouldUpdateStatus(currentStatus, newStatus) {
    if (!currentStatus) return true;
    const currRank = STATUS_RANK[currentStatus.toUpperCase()] || 0;
    const newRank = STATUS_RANK[newStatus.toUpperCase()] || 0;

    if (['FAILED', 'UNSUBSCRIBED', 'COMPLAINT'].includes(newStatus)) {
      return currentStatus !== newStatus;
    }

    return newRank > currRank;
  }

  /**
   * Generate deterministic idempotency key for deduplication
   */
  generateIdempotencyKey(payload) {
    const requestId = payload.requestId || payload.request_id || '';
    const eventId = payload.eventId || payload.event_id || '';
    const recipient = payload.recipient || payload.sendTo || '';
    const msgId = payload.msgId || payload.msg_id || payload.uuid || '';
    const eventName = payload.eventName || payload.event_name || '';

    const rawStr = `${requestId}:${eventId}:${recipient}:${msgId}:${eventName}`;
    return crypto.createHash('md5').update(rawStr).digest('hex');
  }

  /**
   * Verify optional secret header X-MSG91-Webhook-Secret
   */
  async verifySecret(headers) {
    const providedSecret = headers['x-msg91-webhook-secret'] || headers['X-MSG91-Webhook-Secret'];
    
    let expectedSecret = process.env.MSG91_WEBHOOK_SECRET || '';
    try {
      const settings = await settingsService.getSettings();
      if (settings.msg91_webhook_secret) {
        expectedSecret = settings.msg91_webhook_secret;
      }
    } catch {}

    if (expectedSecret && providedSecret !== expectedSecret) {
      const err = new Error('Invalid MSG91 Webhook Secret');
      err.statusCode = 401;
      throw err;
    }
  }

  /**
   * Process incoming MSG91 Email Webhook Event
   */
  async processEmailWebhook(payload, headers = {}) {
    await this.verifySecret(headers);

    if (!payload || typeof payload !== 'object') {
      console.warn('[MSG91 Webhook] Malformed payload received');
      return { success: true, message: 'Malformed payload ignored' };
    }

    const idempotencyKey = this.generateIdempotencyKey(payload);
    const requestId = payload.requestId || payload.request_id || null;
    const uuid = payload.uuid || null;
    const crqid = payload.crqid || payload.crqId || null;
    const recipient = payload.recipient || payload.sendTo || null;
    const sender = payload.sender || null;
    const eventId = payload.eventId || payload.event_id || null;
    const rawEventName = payload.eventName || payload.event_name || 'Queued';
    const normalizedEvent = this.normalizeEventName(rawEventName);
    const msgId = payload.msgId || payload.msg_id || payload.outboundEmailId || null;
    const campaignRequestId = payload.campaignRequestId || null;
    const campaignName = payload.campaignName || null;
    const templateName = payload.templateName || null;
    const subject = payload.subject || null;
    const statusCode = payload.statusCode || null;
    const enhancedStatusCode = payload.enhancedStatusCode || null;
    const reason = payload.reason || null;
    const failureCategory = payload.failureCategory || null;

    const requestedAt = payload.requestedAt ? new Date(payload.requestedAt) : null;
    const statusUpdatedAt = payload.statusUpdatedAt ? new Date(payload.statusUpdatedAt) : (payload.ts ? new Date(payload.ts * 1000) : new Date());

    const sendToParsed = this.safeParseJson(payload.sendTo);
    const ccParsed = this.safeParseJson(payload.cc);
    const bccParsed = this.safeParseJson(payload.bcc);
    const variablesParsed = this.safeParseJson(payload.variables);
    const attachmentsParsed = this.safeParseJson(payload.attachments);

    const safePayloadJson = JSON.stringify({
      ...payload,
      sendToParsed,
      ccParsed,
      bccParsed,
      variablesParsed,
      attachmentsParsed
    });

    console.log(`[MSG91_EMAIL_WEBHOOK_RECEIVED] event=${normalizedEvent} crqid=${crqid} msgId=${msgId} recipient=${recipient}`);

    // 1. Store in msg91_email_webhook_events with Idempotency Check
    let webhookEventId;

    try {
      const [res] = await db.query(
        `INSERT INTO msg91_email_webhook_events (
          idempotency_key, request_id, uuid, crqid, recipient, sender, event_id, event_name,
          normalized_event, msg_id, campaign_request_id, campaign_name, template_name, subject,
          status_code, enhanced_status_code, reason, failure_category, requested_at, status_updated_at,
          raw_payload, processing_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          idempotencyKey, requestId, uuid, crqid, recipient, sender, eventId, rawEventName,
          normalizedEvent, msgId, campaignRequestId, campaignName, templateName, subject,
          statusCode, enhancedStatusCode, reason, failureCategory, requestedAt, statusUpdatedAt,
          safePayloadJson
        ]
      );
      webhookEventId = res.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || (err.message && err.message.includes('idempotency_key'))) {
        console.log(`[MSG91_EMAIL_WEBHOOK_DUPLICATE] Duplicate event received. key=${idempotencyKey}`);
        return { success: true, duplicate: true, message: 'Duplicate webhook event ignored' };
      }
      throw err;
    }

    // 2. Correlate Webhook to CRM Email Record
    let matchedLog = null;
    let matchedRecipient = null;

    if (crqid) {
      if (crqid.startsWith('CRM_LOG_')) {
        const logId = parseInt(crqid.replace('CRM_LOG_', ''), 10);
        if (!isNaN(logId)) {
          const [[log]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
          if (log) matchedLog = log;
        }
      } else if (crqid.startsWith('CRM_CR_')) {
        const [[cr]] = await db.query('SELECT * FROM campaign_recipients WHERE crqid = ?', [crqid]);
        if (cr) matchedRecipient = cr;
      }
    }

    // Fallback correlation by crqid value match
    if (!matchedLog && !matchedRecipient && crqid) {
      const [[log]] = await db.query('SELECT * FROM email_logs WHERE crqid = ?', [crqid]);
      if (log) matchedLog = log;

      if (!matchedLog) {
        const [[cr]] = await db.query('SELECT * FROM campaign_recipients WHERE crqid = ?', [crqid]);
        if (cr) matchedRecipient = cr;
      }
    }

    // Fallback correlation by msgId / requestId
    if (!matchedLog && !matchedRecipient && msgId) {
      const [[log]] = await db.query('SELECT * FROM email_logs WHERE msg_id = ? OR request_id = ?', [msgId, requestId]);
      if (log) matchedLog = log;

      if (!matchedLog) {
        const [[cr]] = await db.query('SELECT * FROM campaign_recipients WHERE msg_id = ? OR request_id = ?', [msgId, requestId]);
        if (cr) matchedRecipient = cr;
      }
    }

    // Fallback correlation by recipient email
    if (!matchedLog && !matchedRecipient && recipient) {
      const [[cr]] = await db.query(
        'SELECT * FROM campaign_recipients WHERE LOWER(email_address) = LOWER(?) ORDER BY id DESC LIMIT 1',
        [recipient.trim()]
      );
      if (cr) matchedRecipient = cr;

      if (!matchedRecipient) {
        const [[log]] = await db.query(
          'SELECT * FROM email_logs WHERE LOWER(recipient_email) = LOWER(?) ORDER BY id DESC LIMIT 1',
          [recipient.trim()]
        );
        if (log) matchedLog = log;
      }
    }

    if (!matchedLog && !matchedRecipient) {
      console.warn(`[MSG91_EMAIL_WEBHOOK_UNMATCHED] Event could not be matched to CRM email. crqid=${crqid} msgId=${msgId} recipient=${recipient}`);
      await db.query(`UPDATE msg91_email_webhook_events SET processing_status = 'UNMATCHED' WHERE id = ?`, [webhookEventId]);
      return { success: true, unmatched: true, message: 'Webhook event stored as UNMATCHED' };
    }

    // 3. Update CRM Email Records (respecting Non-Downgrade Hierarchy)
    const updateTime = statusUpdatedAt || new Date();

    if (matchedLog) {
      const shouldUpdate = this.shouldUpdateStatus(matchedLog.status, normalizedEvent);
      const newStatus = shouldUpdate ? normalizedEvent.toLowerCase() : matchedLog.status;

      const updates = [];
      const params = [];

      if (shouldUpdate) {
        updates.push('status = ?', 'last_event = ?', 'last_event_at = ?');
        params.push(newStatus, normalizedEvent, updateTime);
      }

      if (normalizedEvent === 'DELIVERED' && !matchedLog.delivered_at) {
        updates.push('delivered_at = ?'); params.push(updateTime);
      } else if (normalizedEvent === 'OPENED') {
        if (!matchedLog.opened_at) { updates.push('opened_at = ?'); params.push(updateTime); }
      } else if (normalizedEvent === 'CLICKED') {
        if (!matchedLog.clicked_at) { updates.push('clicked_at = ?'); params.push(updateTime); }
      } else if (normalizedEvent === 'FAILED') {
        if (!matchedLog.failed_at) { updates.push('failed_at = ?'); params.push(updateTime); }
        updates.push('failure_reason = ?', 'failure_category = ?', 'status_code = ?', 'enhanced_status_code = ?');
        params.push(reason, failureCategory, statusCode, enhancedStatusCode);
      } else if (normalizedEvent === 'UNSUBSCRIBED') {
        if (!matchedLog.unsubscribed_at) { updates.push('unsubscribed_at = ?'); params.push(updateTime); }
      } else if (normalizedEvent === 'COMPLAINT') {
        if (!matchedLog.complained_at) { updates.push('complained_at = ?'); params.push(updateTime); }
      }

      if (updates.length > 0) {
        params.push(matchedLog.id);
        await db.query(`UPDATE email_logs SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    }

    if (matchedRecipient) {
      const shouldUpdate = this.shouldUpdateStatus(matchedRecipient.status, normalizedEvent);
      const newStatus = shouldUpdate ? normalizedEvent.toLowerCase() : matchedRecipient.status;

      const updates = [];
      const params = [];

      if (shouldUpdate) {
        updates.push('status = ?', 'updated_at = NOW()');
        params.push(newStatus);
      }

      if (normalizedEvent === 'DELIVERED' && !matchedRecipient.delivered_at) {
        updates.push('delivered_at = ?'); params.push(updateTime);
      } else if (normalizedEvent === 'OPENED') {
        if (!matchedRecipient.opened_at) { updates.push('opened_at = ?'); params.push(updateTime); }
        updates.push('open_count = open_count + 1', 'last_opened_at = ?'); params.push(updateTime);
      } else if (normalizedEvent === 'CLICKED') {
        if (!matchedRecipient.clicked_at) { updates.push('clicked_at = ?'); params.push(updateTime); }
        updates.push('click_count = click_count + 1', 'last_clicked_at = ?'); params.push(updateTime);
      } else if (normalizedEvent === 'FAILED') {
        if (!matchedRecipient.failed_at) { updates.push('failed_at = ?'); params.push(updateTime); }
        updates.push('failure_reason = ?', 'failure_category = ?', 'status_code = ?', 'enhanced_status_code = ?');
        params.push(reason, failureCategory, statusCode, enhancedStatusCode);
      } else if (normalizedEvent === 'UNSUBSCRIBED') {
        if (!matchedRecipient.unsubscribed_at) { updates.push('unsubscribed_at = ?'); params.push(updateTime); }
      } else if (normalizedEvent === 'COMPLAINT') {
        if (!matchedRecipient.complained_at) { updates.push('complained_at = ?'); params.push(updateTime); }
      }

      if (updates.length > 0) {
        params.push(matchedRecipient.id);
        await db.query(`UPDATE campaign_recipients SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    }

    // 4. Update Contact & Lead Status (`users` table)
    const targetRecipientEmail = recipient || matchedLog?.recipient_email || matchedRecipient?.email_address;
    const targetUserId = matchedLog?.user_id || matchedRecipient?.contact_id;

    if (targetRecipientEmail || targetUserId) {
      const [[contact]] = await db.query(
        'SELECT * FROM users WHERE id = ? OR LOWER(email) = LOWER(?) LIMIT 1',
        [targetUserId || 0, (targetRecipientEmail || '').trim()]
      );

      if (contact) {
        if (normalizedEvent === 'UNSUBSCRIBED') {
          await db.query(
            `UPDATE users SET is_opted_out = 1, lead_status = 'Opted Out', updated_at = NOW() WHERE id = ?`,
            [contact.id]
          );
        } else if (normalizedEvent === 'FAILED' && (failureCategory === 'hard_bounce' || (reason && reason.toLowerCase().includes('exist')))) {
          await db.query(
            `UPDATE users SET email_invalid = 1, lead_status = 'Invalid Email', updated_at = NOW() WHERE id = ?`,
            [contact.id]
          );
        } else if ((normalizedEvent === 'OPENED' || normalizedEvent === 'CLICKED') && (contact.lead_status === 'unverified' || !contact.lead_status)) {
          await db.query(
            `UPDATE users SET lead_status = 'Engaged', updated_at = NOW() WHERE id = ?`,
            [contact.id]
          );
        }

        // Insert record into email_events for contact activity feed
        try {
          const campaignId = matchedRecipient?.campaign_id || null;
          await db.query(
            `INSERT INTO email_events (campaign_id, contact_id, recipient_email, event_type, event_source, event_at)
             VALUES (?, ?, ?, ?, 'msg91_webhook', ?)
             ON DUPLICATE KEY UPDATE event_at = VALUES(event_at)`,
            [campaignId, contact.id, contact.email, normalizedEvent, updateTime]
          );
        } catch (eErr) {
          console.warn('[MSG91 Webhook] Event feed insertion warning:', eErr.message);
        }
      }
    }

    console.log(`[MSG91_EMAIL_WEBHOOK_PROCESSED] Successfully processed event=${normalizedEvent} id=${webhookEventId}`);
    return { success: true, processed: true, event: normalizedEvent };
  }
}

module.exports = new WebhookService();
