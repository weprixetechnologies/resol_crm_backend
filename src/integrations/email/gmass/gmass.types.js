/**
 * GMass Request & Webhook Payload Type Mappers & Defensive Normalizers
 */

/**
 * Normalize raw GMass webhook payload to extract consistent fields regardless of casing or schema variations.
 * @param {Object} rawPayload - Raw incoming body from GMass webhook
 * @returns {Object} Normalized event object
 */
function normalizeWebhookPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      campaignId: null,
      email: null,
      eventType: null,
      eventAt: new Date(),
      link: null,
      bounceReason: null,
      raw: rawPayload
    };
  }

  // Extract Campaign ID (cases: campaignId, CampaignID, campaign_id, CampaignId)
  const campaignId = rawPayload.campaignId || rawPayload.CampaignID || rawPayload.campaign_id || rawPayload.CampaignId || null;

  // Extract Email Address (cases: email, emailAddress, Email, EmailAddress, recipient)
  const email = (rawPayload.email || rawPayload.emailAddress || rawPayload.Email || rawPayload.EmailAddress || rawPayload.recipient || '').trim().toLowerCase();

  // Extract Event Type (cases: event, Event, eventType, EventType, type)
  const rawEventType = rawPayload.event || rawPayload.Event || rawPayload.eventType || rawPayload.EventType || rawPayload.type || '';
  let eventType = 'Send';
  if (/open/i.test(rawEventType)) eventType = 'Open';
  else if (/click/i.test(rawEventType)) eventType = 'Click';
  else if (/reply/i.test(rawEventType)) eventType = 'Reply';
  else if (/unsubscribe/i.test(rawEventType)) eventType = 'Unsubscribe';
  else if (/bounce/i.test(rawEventType)) eventType = 'Bounce';
  else if (/send/i.test(rawEventType)) eventType = 'Send';

  // Extract Timestamp (cases: timestamp, Timestamp, date, Date, eventTime, EventTime)
  const rawTime = rawPayload.timestamp || rawPayload.Timestamp || rawPayload.date || rawPayload.Date || rawPayload.eventTime || rawPayload.EventTime;
  let eventAt = new Date();
  if (rawTime) {
    const parsed = new Date(rawTime);
    if (!isNaN(parsed.getTime())) {
      eventAt = parsed;
    }
  }

  // Extract Link clicked (if any)
  const link = rawPayload.link || rawPayload.Link || rawPayload.url || rawPayload.Url || null;

  // Extract Bounce details (if any)
  const bounceReason = rawPayload.bounceReason || rawPayload.BounceReason || rawPayload.reason || rawPayload.Reason || rawPayload.message || null;

  return {
    campaignId: campaignId ? String(campaignId) : null,
    email: email || null,
    eventType,
    eventAt,
    link,
    bounceReason,
    raw: rawPayload
  };
}

module.exports = {
  normalizeWebhookPayload
};
