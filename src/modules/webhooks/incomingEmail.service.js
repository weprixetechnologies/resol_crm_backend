const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const settingsService = require('../settings/settings.service');
const { sanitizeHtml } = require('../../utils/sanitizer.util');

class IncomingEmailService {
  /**
   * Helper to parse email address and display name from raw email string
   * e.g. "John Doe <john@example.com>" -> { name: "John Doe", email: "john@example.com" }
   */
  parseEmailHeader(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return { name: '', email: '' };
    const trimmed = rawStr.trim();
    const match = trimmed.match(/^(?:"?([^"]*)"?\s*)?<?([^\s>]+@[^\s>]+)>?$/);
    if (match) {
      return {
        name: (match[1] || match[2].split('@')[0]).trim(),
        email: match[2].trim().toLowerCase()
      };
    }
    return { name: trimmed.split('@')[0] || '', email: trimmed.toLowerCase() };
  }

  /**
   * Helper to clean subject for fallback thread matching (e.g. "Re: Re: Journal Info" -> "Journal Info")
   */
  cleanSubject(subject) {
    if (!subject || typeof subject !== 'string') return '';
    return subject.replace(/^(re|fwd|fw):\s*/i, '').trim();
  }

  /**
   * Verify optional secret header X-MSG91-Webhook-Secret or query token ?secret=
   */
  async verifySecret(headers = {}, query = {}) {
    const providedSecret = 
      headers['x-msg91-webhook-secret'] || 
      headers['X-MSG91-Webhook-Secret'] || 
      query.secret || 
      query.token;
    
    let expectedSecret = process.env.MSG91_INCOMING_WEBHOOK_SECRET || process.env.MSG91_WEBHOOK_SECRET || '';
    try {
      const settings = await settingsService.getSettings();
      if (settings.msg91_incoming_webhook_secret || settings.msg91_webhook_secret) {
        expectedSecret = settings.msg91_incoming_webhook_secret || settings.msg91_webhook_secret;
      }
    } catch {}

    if (expectedSecret && providedSecret !== expectedSecret) {
      const err = new Error('Invalid MSG91 Webhook Secret');
      err.statusCode = 401;
      throw err;
    }
  }

  /**
   * Process attachments payload (URLs or Base64 data)
   */
  async processAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return [];
    
    const processed = [];
    const uploadDir = path.join(__dirname, '../../../uploads/attachments');
    
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (e) {
      console.warn('[IncomingEmailService] Could not create attachment dir:', e.message);
    }

    for (let i = 0; i < rawAttachments.length; i++) {
      const att = rawAttachments[i];
      if (!att || typeof att !== 'object') continue;

      const filename = (att.filename || att.name || `attachment_${Date.now()}_${i}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const contentType = att.content_type || att.mime_type || att.contentType || 'application/octet-stream';
      const size = att.size || att.file_size || 0;

      // Safe size limit check (Max 10MB)
      if (size > 10 * 1024 * 1024) {
        console.warn(`[IncomingEmailService] Attachment ${filename} exceeds 10MB limit. Skipping download.`);
        processed.push({ filename, contentType, size, error: 'File size exceeds 10MB limit' });
        continue;
      }

      let storedPath = null;

      // Base64 storage
      if (att.content || att.base64) {
        try {
          const base64Data = (att.content || att.base64).replace(/^data:.*;base64,/, '');
          const safeName = `${Date.now()}_${filename}`;
          const fullPath = path.join(uploadDir, safeName);
          fs.writeFileSync(fullPath, Buffer.from(base64Data, 'base64'));
          storedPath = `/uploads/attachments/${safeName}`;
        } catch (bErr) {
          console.warn('[IncomingEmailService] Base64 write failed:', bErr.message);
        }
      } else if (att.url || att.download_url) {
        // URL Download
        try {
          const fileUrl = att.url || att.download_url;
          const resp = await fetch(fileUrl);
          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const safeName = `${Date.now()}_${filename}`;
            const fullPath = path.join(uploadDir, safeName);
            fs.writeFileSync(fullPath, Buffer.from(arrayBuf));
            storedPath = `/uploads/attachments/${safeName}`;
          }
        } catch (uErr) {
          console.warn('[IncomingEmailService] Attachment URL fetch failed:', uErr.message);
        }
      }

      processed.push({
        filename,
        contentType,
        size,
        url: storedPath || att.url || null
      });
    }

    return processed;
  }

  /**
   * Main Handler for Incoming Email Webhook POST
   */
  async processIncomingReply(payload = {}, headers = {}, query = {}) {
    await this.verifySecret(headers, query);

    if (!payload || typeof payload !== 'object') {
      console.warn('[IncomingEmailService] Empty or invalid payload received');
      return { success: true, message: 'Invalid payload ignored' };
    }

    // 1. Normalize Header Fields
    const rawFrom = payload.from || payload.sender || payload.from_email || payload.fromEmail || '';
    const { name: senderName, email: senderEmail } = this.parseEmailHeader(rawFrom);

    const rawTo = payload.to || payload.recipient || payload.to_email || payload.toEmail || '';
    const { name: recipientName, email: recipientEmail } = this.parseEmailHeader(rawTo);

    const subject = (payload.subject || 'No Subject').trim();
    const bodyText = payload.text || payload.plain || payload.body_text || payload['body-plain'] || '';
    const rawHtml = payload.html || payload.body_html || payload.body || payload['body-html'] || bodyText;
    const bodyHtml = sanitizeHtml(rawHtml);

    const messageId = (payload['message-id'] || payload.message_id || payload.msg_id || payload.uuid || '').trim();
    const inReplyTo = (payload['in-reply-to'] || payload.in_reply_to || payload.inReplyTo || '').trim();
    const references = (payload.references || payload.References || '').trim();
    const providerMessageId = (payload.provider_message_id || messageId || `${Date.now()}_${senderEmail}`).trim();

    const receivedAt = payload.timestamp ? new Date(payload.timestamp * 1000) : (payload.received_at ? new Date(payload.received_at) : new Date());

    // Process attachments
    const rawAttachments = payload.attachments || payload.files || [];
    const attachmentsProcessed = await this.processAttachments(rawAttachments);

    // 2. Generate Idempotency Key
    const idempotencyKey = crypto.createHash('md5').update(`${providerMessageId}:${senderEmail}:${subject}`).digest('hex');

    console.log(`[INCOMING_EMAIL_WEBHOOK] Received reply from=${senderEmail} subject="${subject}" messageId=${messageId} inReplyTo=${inReplyTo}`);

    // 3. Match CRM Contact (users table)
    let contactId = null;
    if (senderEmail) {
      const [[contact]] = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [senderEmail]);
      if (contact) {
        contactId = contact.id;
      }
    }

    // 4. Thread Correlation Engine
    let conversationId = null;
    let matchedLog = null;

    // Reliability Step 1: Match In-Reply-To against email_logs.message_id_header or email_messages.message_id
    if (inReplyTo) {
      const [[log]] = await db.query('SELECT id, conversation_id, user_id FROM email_logs WHERE message_id_header = ? OR msg_id = ? LIMIT 1', [inReplyTo, inReplyTo]);
      if (log) {
        matchedLog = log;
        conversationId = log.conversation_id;
        if (!contactId && log.user_id) contactId = log.user_id;
      }

      if (!conversationId) {
        const [[msg]] = await db.query('SELECT conversation_id, contact_id FROM email_messages WHERE message_id = ? OR provider_message_id = ? LIMIT 1', [inReplyTo, inReplyTo]);
        if (msg) {
          conversationId = msg.conversation_id;
          if (!contactId && msg.contact_id) contactId = msg.contact_id;
        }
      }
    }

    // Reliability Step 2: Match References header
    if (!conversationId && references) {
      const refList = references.split(/\s+/).filter(Boolean);
      for (const ref of refList) {
        const [[log]] = await db.query('SELECT id, conversation_id, user_id FROM email_logs WHERE message_id_header = ? OR msg_id = ? LIMIT 1', [ref, ref]);
        if (log) {
          matchedLog = log;
          conversationId = log.conversation_id;
          if (!contactId && log.user_id) contactId = log.user_id;
          break;
        }
      }
    }

    // Reliability Step 3: Fallback match customer ID + base subject
    const baseSubject = this.cleanSubject(subject);
    if (!conversationId && contactId && baseSubject) {
      const [[conv]] = await db.query(
        'SELECT id FROM email_conversations WHERE contact_id = ? AND (LOWER(subject) LIKE LOWER(?) OR LOWER(?) LIKE CONCAT("%", LOWER(subject), "%")) ORDER BY last_message_at DESC LIMIT 1',
        [contactId, `%${baseSubject}%`, baseSubject]
      );
      if (conv) {
        conversationId = conv.id;
      }
    }

    // 5. Create Conversation if No Existing Thread Found
    if (!conversationId) {
      const [convRes] = await db.query(
        `INSERT INTO email_conversations (contact_id, subject, last_message_at) VALUES (?, ?, ?)`,
        [contactId, baseSubject || subject, receivedAt]
      );
      conversationId = convRes.insertId;
    } else {
      await db.query(
        `UPDATE email_conversations SET last_message_at = ?, updated_at = NOW() WHERE id = ?`,
        [receivedAt, conversationId]
      );
    }

    // 6. Save Inbound Message to email_messages Table (Idempotent Check)
    let emailMessageId;
    try {
      const [msgRes] = await db.query(
        `INSERT INTO email_messages (
          conversation_id, contact_id, email_log_id, direction, from_email, from_name,
          to_email, to_name, subject, body_text, body_html, message_id, in_reply_to,
          references_header, provider_message_id, received_at, attachments, raw_payload
        ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conversationId,
          contactId,
          matchedLog ? matchedLog.id : null,
          senderEmail,
          senderName,
          recipientEmail,
          recipientName,
          subject,
          bodyText,
          bodyHtml,
          messageId,
          inReplyTo,
          references,
          providerMessageId,
          receivedAt,
          JSON.stringify(attachmentsProcessed),
          JSON.stringify(payload)
        ]
      );
      emailMessageId = msgRes.insertId;
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY' || (dbErr.message && dbErr.message.includes('provider_message_id'))) {
        console.log(`[INCOMING_EMAIL_DUPLICATE] Duplicate reply message ignored. key=${providerMessageId}`);
        return { success: true, duplicate: true, message: 'Duplicate email reply ignored' };
      }
      throw dbErr;
    }

    // 7. Insert Audit & Contact Activity Feed
    try {
      await db.query(
        `INSERT INTO email_events (email_log_id, provider, provider_event_id, event_name, event_type, event_status, event_timestamp, recipient, recipient_email, raw_payload)
         VALUES (?, 'MSG91', ?, 'INBOUND_REPLY', 'INBOUND_REPLY', 'RECEIVED', ?, ?, ?, ?)`,
        [matchedLog ? matchedLog.id : null, providerMessageId, receivedAt, senderEmail, senderEmail, JSON.stringify({ conversationId, emailMessageId, subject })]
      );

      if (contactId) {
        await db.query(
          `UPDATE users SET lead_status = 'Replied', updated_at = NOW() WHERE id = ?`,
          [contactId]
        );
      }
    } catch (eErr) {
      console.warn('[IncomingEmailService] Event insertion warning:', eErr.message);
    }

    console.log(`[INCOMING_EMAIL_SUCCESS] Inbound reply saved. messageId=${emailMessageId} conversationId=${conversationId} contactId=${contactId}`);

    return {
      success: true,
      emailMessageId,
      conversationId,
      contactId,
      status: 'PROCESSED'
    };
  }
}

module.exports = new IncomingEmailService();
