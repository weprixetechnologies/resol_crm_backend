const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const settingsService = require('../settings/settings.service');
const { sanitizeHtml } = require('../../utils/sanitizer.util');
const { parseMimeSource, htmlToPlainText } = require('../../utils/mimeParser.util');

class IncomingEmailService {
  /**
   * Helper to parse email address and display name from string or MSG91 object
   * e.g. { display: "weprixe", address: "weprixeofficial@gmail.com" }
   * or "John Doe <john@example.com>" -> { name: "John Doe", email: "john@example.com" }
   */
  parseEmailHeader(rawVal) {
    if (!rawVal) return { name: '', email: '' };

    if (typeof rawVal === 'object') {
      const email = (rawVal.address || rawVal.email || rawVal.to || rawVal.from || '').toString().trim().toLowerCase();
      const name = (rawVal.display || rawVal.name || (email ? email.split('@')[0] : '')).toString().trim();
      return { name, email };
    }

    let str = String(rawVal).trim();

    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        const email = (parsed.address || parsed.email || parsed.to || parsed.from || '').toString().trim().toLowerCase();
        const name = (parsed.display || parsed.name || (email ? email.split('@')[0] : '')).toString().trim();
        if (email) return { name, email };
      } catch {}
    }

    const match = str.match(/^(?:"?([^"]*)"?\s*)?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?$/i);
    if (match) {
      return {
        name: (match[1] || match[2].split('@')[0]).trim(),
        email: match[2].trim().toLowerCase()
      };
    }

    const emailRegexMatch = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailRegexMatch) {
      const email = emailRegexMatch[0].toLowerCase();
      return { name: email.split('@')[0], email };
    }

    return { name: str.split('@')[0] || '', email: str.toLowerCase() };
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
   * Process attachments payload (URLs, Base64 data, or Buffer)
   * Enforces 10MB limit and safe filename sanitization.
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
      const contentType = att.contentType || att.content_type || att.mime_type || 'application/octet-stream';
      const size = att.size || (att.data ? att.data.length : 0);
      const isInline = Boolean(att.isInline || att.related || att.contentId);

      // Safe size limit check (Max 10MB)
      if (size > 10 * 1024 * 1024) {
        console.warn(`[IncomingEmailService] Attachment ${filename} exceeds 10MB limit. Skipping.`);
        processed.push({ filename, contentType, size, isInline, error: 'File size exceeds 10MB limit' });
        continue;
      }

      let storedPath = null;

      if (Buffer.isBuffer(att.data)) {
        try {
          const safeName = `${Date.now()}_${filename}`;
          const fullPath = path.join(uploadDir, safeName);
          fs.writeFileSync(fullPath, att.data);
          storedPath = `/uploads/attachments/${safeName}`;
        } catch (fErr) {
          console.warn('[IncomingEmailService] Buffer write failed:', fErr.message);
        }
      } else if (att.content || att.base64) {
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
        isInline,
        contentId: att.contentId || att.cid || null,
        url: storedPath || att.url || null
      });
    }

    return processed;
  }

  /**
   * Main Handler for MSG91 Incoming Email Webhook POST
   */
  async processIncomingReply(payload = {}, headers = {}, query = {}) {
    await this.verifySecret(headers, query);

    if (!payload || typeof payload !== 'object') {
      console.warn('[IncomingEmailService] Empty or invalid payload received');
      return { success: true, message: 'Invalid payload ignored' };
    }

    const providerMessageId = (payload.provider_message_id || payload.id || payload.messageId || payload['message-id'] || `${Date.now()}`).trim();

    console.log(`[INCOMING_EMAIL_WEBHOOK] Received MSG91 Inbound Webhook (Provider ID: ${providerMessageId}). Subject="${payload.subject || 'No Subject'}"`);

    // 1. Attempt Raw MIME Source Parsing if raw RFC822 string is passed
    let mimeParsed = null;
    let rawMimeString = null;

    if (typeof payload.raw === 'string' && (payload.raw.startsWith('From:') || payload.raw.startsWith('Received:') || payload.raw.includes('MIME-Version:'))) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] Raw RFC822 MIME source detected in payload.raw. Parsing MIME source...`);
      rawMimeString = payload.raw;
      mimeParsed = await parseMimeSource(payload.raw);
    } else if (typeof payload.mime === 'string' && payload.mime.length > 0) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] Raw RFC822 MIME source detected in payload.mime. Parsing MIME source...`);
      rawMimeString = payload.mime;
      mimeParsed = await parseMimeSource(payload.mime);
    } else if (typeof payload.raw_content === 'string' && payload.raw_content.length > 0) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] Raw RFC822 MIME source detected in payload.raw_content. Parsing MIME source...`);
      rawMimeString = payload.raw_content;
      mimeParsed = await parseMimeSource(payload.raw_content);
    } else if (typeof payload.headers === 'string' && payload.headers.includes('Content-Type:')) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] Raw RFC822 MIME source detected in payload.headers. Parsing MIME source...`);
      rawMimeString = payload.headers;
      mimeParsed = await parseMimeSource(payload.headers);
    } else if (payload.raw) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] MSG91 provided raw S3 relative path: "${payload.raw}". MSG91 REST API does not expose a public endpoint for raw file download. Using direct payload parameter extraction...`);
    }

    // 2. Normalize Fields from MIME Parser or Direct Webhook Payload
    let senderName = '';
    let senderEmail = '';
    let recipientName = '';
    let recipientEmail = '';
    let ccStr = '';
    let bccStr = '';
    let subject = '';
    let textBody = '';
    let rawHtmlBody = '';
    let messageId = '';
    let rawInReplyTo = '';
    let references = '';
    let receivedAt = new Date();
    let rawAttachments = [];

    if (mimeParsed) {
      console.log(`[INCOMING_EMAIL_WEBHOOK] MIME parsing success! Extracted textBodyLength=${(mimeParsed.textBody || '').length}, htmlBodyLength=${(mimeParsed.htmlBody || '').length}, attachmentCount=${(mimeParsed.attachments || []).length}`);
      senderName = mimeParsed.from.name;
      senderEmail = mimeParsed.from.email;
      recipientName = mimeParsed.to.name;
      recipientEmail = mimeParsed.to.email;
      ccStr = mimeParsed.cc || '';
      bccStr = mimeParsed.bcc || '';
      subject = mimeParsed.subject;
      textBody = mimeParsed.textBody || '';
      rawHtmlBody = mimeParsed.htmlBody || '';
      messageId = mimeParsed.messageId;
      rawInReplyTo = mimeParsed.inReplyTo;
      references = mimeParsed.references;
      receivedAt = mimeParsed.receivedAt || new Date();
      rawAttachments = mimeParsed.attachments || [];
    } else {
      // Direct Webhook Parameter Extraction
      const rawFrom = payload.from || payload.sender || payload.from_email || payload.fromEmail || '';
      const parsedFrom = this.parseEmailHeader(rawFrom);
      senderName = parsedFrom.name;
      senderEmail = parsedFrom.email;

      const rawTo = payload.to || payload.recipient || payload.receiver || payload.to_email || payload.toEmail || '';
      const parsedTo = this.parseEmailHeader(rawTo);
      recipientName = parsedTo.name;
      recipientEmail = parsedTo.email;

      ccStr = typeof payload.cc === 'string' ? payload.cc : (Array.isArray(payload.cc) ? payload.cc.join(', ') : '');
      bccStr = typeof payload.bcc === 'string' ? payload.bcc : (Array.isArray(payload.bcc) ? payload.bcc.join(', ') : '');

      subject = (payload.subject || 'No Subject').trim();

      // Extract body text & HTML
      textBody = payload.text || payload.plain || payload.body_text || payload.body_plain || payload['body-plain'] || payload.stripped_text || payload['stripped-text'] || payload.content || '';
      if (!textBody && typeof payload.body === 'string') {
        textBody = payload.body;
      }
      if (!textBody && payload.body && typeof payload.body === 'object') {
        textBody = payload.body.text || payload.body.plain || payload.body.html || '';
      }

      rawHtmlBody = payload.html || payload.body_html || payload['body-html'] || payload.stripped_html || payload['stripped-html'] || '';
      if (typeof payload.body === 'string' && (payload.body.includes('<p>') || payload.body.includes('<div>') || payload.body.includes('<br>') || payload.body.includes('<html'))) {
        rawHtmlBody = payload.body;
      }

      // If textBody is missing but HTML exists, generate safe plain-text
      if (!textBody && rawHtmlBody) {
        textBody = htmlToPlainText(rawHtmlBody);
      }

      messageId = (payload.messageId || payload['message-id'] || payload.message_id || payload.msg_id || payload.uuid || payload.id || '').trim();
      rawInReplyTo = (payload.inReplyTo || payload['in-reply-to'] || payload.in_reply_to || '').trim();
      references = (payload.references || payload.References || '').trim();

      receivedAt = payload.timestamp ? new Date(payload.timestamp * 1000) : (payload.createdAt ? new Date(payload.createdAt) : (payload.received_at ? new Date(payload.received_at) : new Date()));
      rawAttachments = payload.attachments || payload.files || [];
    }

    // 3. Body Sanitization & Formatting
    // Prefer text/plain for textBody; Prefer text/html for htmlBody
    let htmlBody = null;
    if (rawHtmlBody && rawHtmlBody.trim().length > 0) {
      htmlBody = sanitizeHtml(rawHtmlBody);
    }

    // If only plain text exists, leave htmlBody null/empty
    if (!htmlBody && textBody) {
      htmlBody = null;
    }

    console.log(`[INCOMING_EMAIL_WEBHOOK] Extracted email content: textBodyLength=${(textBody || '').length}, htmlBodyLength=${(htmlBody || '').length}`);

    const cleanInReplyTo = rawInReplyTo.replace(/^<|>$/g, '').trim();
    const formattedInReplyTo = cleanInReplyTo ? `<${cleanInReplyTo}>` : '';

    // Process attachments
    const attachmentsProcessed = await this.processAttachments(rawAttachments);

    // 4. Match CRM Contact (users table)
    let contactId = null;
    if (senderEmail) {
      const [[contact]] = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [senderEmail]);
      if (contact) {
        contactId = contact.id;
      }
    }

    // 5. Thread Correlation Engine
    let conversationId = null;
    let matchedLog = null;

    // Reliability Step 1: Match In-Reply-To against email_logs or email_messages
    if (cleanInReplyTo) {
      const [[log]] = await db.query(
        `SELECT id, conversation_id, user_id FROM email_logs 
         WHERE message_id_header = ? OR message_id_header = ? 
            OR msg_id = ? OR msg_id = ? 
            OR request_id = ? OR request_id = ? 
            OR crqid = ? OR crqid = ? 
            OR msg91_uuid = ? OR msg91_uuid = ?
         LIMIT 1`,
        [
          formattedInReplyTo, cleanInReplyTo,
          formattedInReplyTo, cleanInReplyTo,
          formattedInReplyTo, cleanInReplyTo,
          formattedInReplyTo, cleanInReplyTo,
          formattedInReplyTo, cleanInReplyTo
        ]
      );
      if (log) {
        matchedLog = log;
        conversationId = log.conversation_id;
        if (!contactId && log.user_id) contactId = log.user_id;
      }

      if (!conversationId) {
        const [[msg]] = await db.query(
          `SELECT conversation_id, contact_id FROM email_messages 
           WHERE message_id = ? OR message_id = ? OR provider_message_id = ? OR provider_message_id = ? 
           LIMIT 1`,
          [formattedInReplyTo, cleanInReplyTo, formattedInReplyTo, cleanInReplyTo]
        );
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
        const cleanRef = ref.replace(/^<|>$/g, '').trim();
        const formattedRef = `<${cleanRef}>`;
        const [[log]] = await db.query('SELECT id, conversation_id, user_id FROM email_logs WHERE message_id_header = ? OR message_id_header = ? OR msg_id = ? OR msg_id = ? LIMIT 1', [formattedRef, cleanRef, formattedRef, cleanRef]);
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

    // 6. Create Conversation if No Existing Thread Found
    if (!conversationId) {
      const [convRes] = await db.query(
        `INSERT INTO email_conversations (contact_id, subject, last_message_at) VALUES (?, ?, ?)`,
        [contactId, baseSubject || subject, receivedAt]
      );
      conversationId = convRes.insertId;
      console.log(`[INCOMING_EMAIL_WEBHOOK] Created new conversation thread #${conversationId} for subject="${subject}"`);
    } else {
      await db.query(
        `UPDATE email_conversations SET last_message_at = ?, updated_at = NOW() WHERE id = ?`,
        [receivedAt, conversationId]
      );
      console.log(`[INCOMING_EMAIL_WEBHOOK] Matched existing conversation thread #${conversationId}`);
    }

    // 7. Save Inbound Message to email_messages Table (Idempotent Check)
    let emailMessageId;
    try {
      const [msgRes] = await db.query(
        `INSERT INTO email_messages (
          conversation_id, contact_id, email_log_id, direction, from_email, from_name,
          to_email, to_name, cc, bcc, subject, body_text, body_html, message_id, in_reply_to,
          references_header, provider_message_id, received_at, attachments, raw_mime, raw_payload
        ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conversationId,
          contactId,
          matchedLog ? matchedLog.id : null,
          senderEmail,
          senderName,
          recipientEmail,
          recipientName,
          ccStr || null,
          bccStr || null,
          subject,
          textBody,
          htmlBody,
          messageId,
          rawInReplyTo,
          references,
          providerMessageId,
          receivedAt,
          JSON.stringify(attachmentsProcessed),
          rawMimeString,
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

    // 8. Insert Audit & Contact Activity Feed
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

    console.log(`[INCOMING_EMAIL_SUCCESS] Inbound reply saved. emailMessageId=${emailMessageId} conversationId=${conversationId} contactId=${contactId} textLen=${(textBody || '').length} htmlLen=${(htmlBody || '').length} attachments=${attachmentsProcessed.length}`);

    return {
      success: true,
      emailMessageId,
      conversationId,
      contactId,
      textBodyLength: (textBody || '').length,
      htmlBodyLength: (htmlBody || '').length,
      attachmentCount: attachmentsProcessed.length,
      status: 'PROCESSED'
    };
  }
}

module.exports = new IncomingEmailService();
