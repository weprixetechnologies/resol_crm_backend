const { Worker } = require('bullmq');
const connection = require('../config/bullConnection');
const db = require('../config/db');
const mailService = require('../modules/mail/mail.service');
const { getActiveEmailProvider } = require('../integrations/email');

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    const { logId, campaignId, recipient, subject, bodyHtml, templateId, senderId } = job.data;
    const recipientEmail = recipient && recipient.email ? recipient.email.trim() : '';

    const finalSubject = mailService.interpolate(subject, recipient?.customerObj || recipient);
    const finalBody = mailService.interpolate(bodyHtml, recipient?.customerObj || recipient);

    try {
      if (!recipientEmail) {
        throw new Error('Recipient email is missing');
      }

      const crqid = campaignId
        ? `CRM_CR_${campaignId}_${recipient.user_id || recipientEmail.replace(/[^a-zA-Z0-9]/g, '')}`
        : logId
          ? `CRM_LOG_${logId}`
          : `CRM_GEN_${Date.now()}_${recipient.user_id || recipientEmail.replace(/[^a-zA-Z0-9]/g, '')}`;

      // Resolve MSG91 template slug/id from DB if internal template ID is passed
      let resolvedTemplateId = templateId;
      if (templateId && (typeof templateId === 'number' || /^\d+$/.test(String(templateId)))) {
        const [intRows] = await db.query(
          'SELECT msg91_template_id, provider_status FROM email_template_integrations WHERE crm_template_id = ? AND provider = "MSG91"',
          [templateId]
        );
        if (intRows.length > 0) {
          if (intRows[0].provider_status !== 'APPROVED') {
            throw new Error(`Email dispatch blocked: CRM Template #${templateId} status is ${intRows[0].provider_status}. Only APPROVED templates can be sent.`);
          }
          resolvedTemplateId = intRows[0].msg91_template_id;
        } else {
          const [tRows] = await db.query('SELECT msg91_template_id, msg91_slug, status FROM email_templates WHERE id = ?', [templateId]);
          if (tRows.length > 0) {
            if (tRows[0].status !== 'APPROVED') {
              throw new Error(`Email dispatch blocked: CRM Template #${templateId} status is ${tRows[0].status}. Only APPROVED templates can be sent.`);
            }
            resolvedTemplateId = tRows[0].msg91_template_id || tRows[0].msg91_slug;
          } else {
            resolvedTemplateId = null;
          }
        }
      }

      // Execute send via active Email Provider (MSG91 or Nodemailer)
      const provider = await getActiveEmailProvider();
      const sendRes = await provider.sendTransactional({
        to: recipientEmail,
        subject: finalSubject,
        html: finalBody,
        templateId: resolvedTemplateId,
        crqid
      });

      const msgId = sendRes?.messageId || null;

      // Update log to 'sent'
      if (logId) {
        await db.query(
          `UPDATE email_logs SET status = 'sent', crqid = ?, msg_id = ?, error_message = NULL WHERE id = ?`,
          [crqid, msgId, logId]
        );
      } else {
        await db.query(
          `INSERT INTO email_logs (crqid, msg_id, recipient_email, recipient_name, user_id, template_id, subject, status, sent_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?)`,
          [crqid, msgId, recipient.email, recipient.name || null, recipient.user_id || null, templateId || null, finalSubject, senderId]
        );
      }

      // Update campaign_recipients status if associated with a campaign
      if (campaignId) {
        await db.query(
          `UPDATE campaign_recipients SET status = 'sent', crqid = ?, msg_id = ?, sent_at = NOW() WHERE campaign_id = ? AND (contact_id = ? OR email_address = ?)`,
          [crqid, msgId, campaignId, recipient.user_id || null, recipientEmail]
        );
      }

      // Record Send event in email_events for live feed visibility
      try {
        await db.query(
          `INSERT INTO email_events (campaign_id, contact_id, recipient_email, event_type, event_source, event_at)
           VALUES (?, ?, ?, 'Send', 'worker', NOW())
           ON DUPLICATE KEY UPDATE event_at = VALUES(event_at)`,
          [campaignId || null, recipient.user_id || null, recipientEmail]
        );
      } catch (eErr) {
        console.warn('[Email Worker] Event log warning:', eErr.message);
      }

      return { recipient: recipient.email, status: 'sent' };
    } catch (err) {
      const errorMessage = err.message || 'Email dispatch failed';

      // Update log to 'failed'
      if (logId) {
        await db.query(
          `UPDATE email_logs SET status = 'failed', error_message = ? WHERE id = ?`,
          [errorMessage, logId]
        );
      } else {
        await db.query(
          `INSERT INTO email_logs (recipient_email, recipient_name, user_id, template_id, subject, status, error_message, sent_by)
           VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`,
          [recipient.email, recipient.name || null, recipient.user_id || null, templateId || null, finalSubject, errorMessage, senderId]
        );
      }

      if (campaignId) {
        await db.query(
          `UPDATE campaign_recipients SET status = 'failed' WHERE campaign_id = ? AND (contact_id = ? OR email_address = ?)`,
          [campaignId, recipient.user_id || null, recipientEmail]
        );
      }

      throw err; // Re-throw to let BullMQ track retries
    }
  },
  {
    connection,
    concurrency: 5 // Process 5 background emails concurrently
  }
);

emailWorker.on('completed', (job) => {
  console.log(`[BullMQ Worker] Email Job #${job.id} completed for ${job.data?.recipient?.email}`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[BullMQ Worker] Email Job #${job?.id} failed for ${job?.data?.recipient?.email}:`, err.message);
});

console.log('[BullMQ Worker] Email worker initialized and listening on "emailQueue"');

module.exports = emailWorker;
