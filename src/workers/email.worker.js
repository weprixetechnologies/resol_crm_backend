const { Worker } = require('bullmq');
const connection = require('../config/bullConnection');
const db = require('../config/db');
const mailService = require('../modules/mail/mail.service');

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    const { logId, recipient, subject, bodyHtml, templateId, senderId } = job.data;

    const { transporter, fromEmail, fromName } = await mailService.getTransporter();

    const finalSubject = mailService.interpolate(subject, recipient.customerObj);
    const finalBody = mailService.interpolate(bodyHtml, recipient.customerObj);

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipient.name ? `"${recipient.name}" <${recipient.email}>` : recipient.email,
      subject: finalSubject,
      html: finalBody
    };

    try {
      await transporter.sendMail(mailOptions);

      // Update log to 'sent'
      if (logId) {
        await db.query(
          `UPDATE email_logs SET status = 'sent', error_message = NULL WHERE id = ?`,
          [logId]
        );
      } else {
        await db.query(
          `INSERT INTO email_logs (recipient_email, recipient_name, user_id, template_id, subject, status, sent_by)
           VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
          [recipient.email, recipient.name || null, recipient.user_id || null, templateId || null, finalSubject, senderId]
        );
      }

      return { recipient: recipient.email, status: 'sent' };
    } catch (err) {
      const errorMessage = err.message || 'SMTP dispatch failed';

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
