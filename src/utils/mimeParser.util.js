const { simpleParser } = require('mailparser');

/**
 * Converts HTML string to plain text fallback if text/plain part is missing
 */
function htmlToPlainText(htmlStr) {
  if (!htmlStr || typeof htmlStr !== 'string') return '';
  return htmlStr
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Robust RFC 822 / MIME Email Parser
 * Parses raw MIME strings or Buffers into normalized CRM structures.
 */
async function parseMimeSource(mimeSource) {
  if (!mimeSource) return null;

  try {
    const parsed = await simpleParser(mimeSource);

    // Sender normalization
    const fromAddr = parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0] : null;
    const from = {
      name: fromAddr ? (fromAddr.name || fromAddr.address.split('@')[0]) : '',
      email: fromAddr ? fromAddr.address.toLowerCase() : ''
    };

    // Recipients normalization
    const toList = parsed.to && parsed.to.value ? parsed.to.value.map(t => ({ name: t.name || t.address.split('@')[0], email: t.address.toLowerCase() })) : [];
    const ccList = parsed.cc && parsed.cc.value ? parsed.cc.value.map(t => t.address.toLowerCase()) : [];
    const bccList = parsed.bcc && parsed.bcc.value ? parsed.bcc.value.map(t => t.address.toLowerCase()) : [];

    const subject = parsed.subject || 'No Subject';

    // Body Extraction
    let textBody = (parsed.text || '').trim();
    let htmlBody = (parsed.html || '').trim();

    // Prefer text/plain; if missing but HTML exists, generate safe plain-text
    if (!textBody && htmlBody) {
      textBody = htmlToPlainText(htmlBody);
    }

    // If only plain text exists, leave htmlBody null/empty unless explicitly formatted
    if (!htmlBody) {
      htmlBody = null;
    }

    // Header Metadata
    const messageId = (parsed.messageId || '').trim();
    const inReplyTo = (parsed.inReplyTo || '').trim();
    const references = Array.isArray(parsed.references) 
      ? parsed.references.join(' ') 
      : (parsed.references || '').trim();
    const receivedAt = parsed.date || new Date();

    // Process attachments & distinguish inline images
    const attachments = [];
    if (Array.isArray(parsed.attachments)) {
      for (const att of parsed.attachments) {
        const isInline = Boolean(att.related || (att.contentDisposition === 'inline') || att.cid);
        attachments.push({
          filename: att.filename || att.cid || `file_${Date.now()}`,
          contentType: att.contentType || 'application/octet-stream',
          size: att.size || (att.content ? att.content.length : 0),
          contentId: att.cid || null,
          isInline,
          data: att.content // Buffer
        });
      }
    }

    return {
      from,
      to: toList[0] || { name: '', email: '' },
      toList,
      cc: ccList.join(', '),
      bcc: bccList.join(', '),
      subject,
      textBody,
      htmlBody,
      messageId,
      inReplyTo,
      references,
      attachments,
      receivedAt
    };
  } catch (err) {
    console.error('[MimeParser] Error parsing MIME source:', err.message);
    return null;
  }
}

module.exports = {
  parseMimeSource,
  htmlToPlainText
};
