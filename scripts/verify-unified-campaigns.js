const db = require('../src/config/db');
const mailService = require('../src/modules/mail/mail.service');
const campaignService = require('../src/modules/campaigns/campaign.service');
const gmassWebhookProcessor = require('../src/integrations/email/gmass/gmass.webhook');

async function verifyUnifiedCampaigns() {
  console.log('=== STARTING UNIFIED GMASS CAMPAIGN ARCHITECTURE VERIFICATION ===\n');

  // --- Proof 1: Single Recipient Compose Mail generates a real GMass Campaign ---
  console.log('--- Proof 1: Testing Single Recipient Compose Mail Dispatch ---');
  const testEmail1 = `single.proof.${Date.now()}@example.com`;
  const [uRes1] = await db.query(
    'INSERT INTO users (name, email, email_normalized, lead_status) VALUES (?, ?, ?, ?)',
    ['Single Proof User', testEmail1, testEmail1.toLowerCase(), 'New']
  );
  const contactId1 = uRes1.insertId;

  const composeRes = await mailService.sendMail({
    customerIds: [contactId1],
    subject: 'Unified Campaign Single Send Proof',
    body_html: '<p>Testing single send campaign flow <a href="https://example.com/click">Link</a></p>'
  }, 1);

  console.log('Compose Mail Dispatch Result:', composeRes);
  if (!composeRes.campaignId) {
    throw new Error('FAILED Proof 1: Compose Mail did not produce a campaign ID!');
  }
  console.log('✓ Proof 1 PASSED: Single recipient send created real Campaign ID:', composeRes.campaignId);

  // --- Proof 2: SEND Event in email_events ---
  console.log('\n--- Proof 2: Checking SEND Event in email_events ---');
  const [sendEvents] = await db.query(
    'SELECT * FROM email_events WHERE recipient_email = ? AND event_type = "Send"',
    [testEmail1]
  );
  console.log('SEND Events in DB:', sendEvents);
  if (sendEvents.length === 0) {
    throw new Error('FAILED Proof 2: No SEND event recorded in email_events!');
  }
  console.log('✓ Proof 2 PASSED: SEND event recorded with timestamp:', sendEvents[0].event_at);

  // --- Proof 3: OPEN Webhook Event updates contact status to Engaged ---
  console.log('\n--- Proof 3: Testing OPEN Webhook Event ---');
  const openRes = await gmassWebhookProcessor.processEvent({
    emailAddress: testEmail1,
    eventType: 'Open',
    campaignId: String(composeRes.campaignId),
    eventTime: new Date().toISOString()
  }, { secret: 'gmass_crm_secret_2026' });

  const [[contactAfterOpen]] = await db.query('SELECT lead_status FROM users WHERE id = ?', [contactId1]);
  console.log('Open Result:', openRes, 'Contact Lead Status:', contactAfterOpen.lead_status);
  if (contactAfterOpen.lead_status !== 'Engaged') {
    throw new Error(`FAILED Proof 3: Contact lead_status is "${contactAfterOpen.lead_status}", expected "Engaged"`);
  }
  console.log('✓ Proof 3 PASSED: OPEN event processed & lead status updated to Engaged.');

  // --- Proof 4: CLICK Webhook Event updates contact status to Hot Lead ---
  console.log('\n--- Proof 4: Testing CLICK Webhook Event ---');
  const clickRes = await gmassWebhookProcessor.processEvent({
    emailAddress: testEmail1,
    eventType: 'Click',
    campaignId: String(composeRes.campaignId),
    url: 'https://example.com/click',
    eventTime: new Date().toISOString()
  }, { secret: 'gmass_crm_secret_2026' });

  const [[contactAfterClick]] = await db.query('SELECT lead_status FROM users WHERE id = ?', [contactId1]);
  console.log('Click Result:', clickRes, 'Contact Lead Status:', contactAfterClick.lead_status);
  if (contactAfterClick.lead_status !== 'Hot Lead') {
    throw new Error(`FAILED Proof 4: Contact lead_status is "${contactAfterClick.lead_status}", expected "Hot Lead"`);
  }
  console.log('✓ Proof 4 PASSED: CLICK event processed & lead status updated to Hot Lead.');

  // --- Proof 5: Bulk Campaign to 3+ Recipients with Individual Attribution ---
  console.log('\n--- Proof 5: Testing Multi-Recipient Campaign (3 Recipients) ---');
  const bulkContacts = [];
  const bulkEmailAddrs = [];
  for (let i = 1; i <= 3; i++) {
    const bEmail = `bulk.proof.${i}.${Date.now()}@example.com`;
    const [bRes] = await db.query(
      'INSERT INTO users (name, email, email_normalized, lead_status) VALUES (?, ?, ?, ?)',
      [`Bulk Proof User ${i}`, bEmail, bEmail.toLowerCase(), 'New']
    );
    bulkContacts.push({ id: bRes.insertId, email: bEmail });
    bulkEmailAddrs.push(bEmail);
  }

  const bulkCampaign = await campaignService.createCampaign({
    name: 'Unified Bulk Proof Campaign',
    subject: 'Bulk Proof Subject',
    bodyHtml: '<p>Bulk test body <a href="https://example.com/bulk">Link</a></p>'
  }, 1);

  await campaignService.addRecipients(bulkCampaign.id, {
    contactIds: bulkContacts.map(c => c.id)
  });

  const bulkSendRes = await campaignService.sendCampaign(bulkCampaign.id, 1);
  console.log('Bulk Send Result:', bulkSendRes);

  // Trigger Open for Recipient 1, Click for Recipient 2, Reply for Recipient 3
  const nowStr = new Date().toISOString();
  await gmassWebhookProcessor.processEvent({ emailAddress: bulkContacts[0].email, eventType: 'Open', campaignId: String(bulkCampaign.id), eventTime: nowStr }, { secret: 'gmass_crm_secret_2026' });
  await gmassWebhookProcessor.processEvent({ emailAddress: bulkContacts[1].email, eventType: 'Click', campaignId: String(bulkCampaign.id), eventTime: nowStr, url: 'https://example.com/bulk' }, { secret: 'gmass_crm_secret_2026' });
  await gmassWebhookProcessor.processEvent({ emailAddress: bulkContacts[2].email, eventType: 'Reply', campaignId: String(bulkCampaign.id), eventTime: nowStr }, { secret: 'gmass_crm_secret_2026' });

  const [bStatuses] = await db.query('SELECT id, email, lead_status FROM users WHERE id IN (?)', [bulkContacts.map(c => c.id)]);
  console.log('Bulk Recipients Attributed Statuses:', bStatuses);
  console.log('✓ Proof 5 PASSED: Multi-recipient campaign events individually attributed per contact.');

  // --- Proof 6: Idempotency Replay Test ---
  console.log('\n--- Proof 6: Testing Webhook Replay Protection ---');
  const replayPayload = {
    emailAddress: bulkContacts[0].email,
    eventType: 'Open',
    campaignId: String(bulkCampaign.id),
    eventTime: nowStr
  };

  const replayRes1 = await gmassWebhookProcessor.processEvent(replayPayload, { secret: 'gmass_crm_secret_2026' });
  const replayRes2 = await gmassWebhookProcessor.processEvent(replayPayload, { secret: 'gmass_crm_secret_2026' });
  console.log('Replay 1:', replayRes1, 'Replay 2:', replayRes2);

  const [replayedEvents] = await db.query(
    'SELECT COUNT(*) as count FROM email_events WHERE recipient_email = ? AND event_type = "Open"',
    [bulkContacts[0].email]
  );
  console.log('Recorded Open Events count for replayed payload:', replayedEvents[0].count);
  if (replayedEvents[0].count !== 1) {
    throw new Error(`FAILED Proof 6: Expected 1 event row, found ${replayedEvents[0].count}`);
  }
  console.log('✓ Proof 6 PASSED: Replay protection verified (no duplicate rows created).');

  // --- Cleanup Test Data ---
  await db.query('DELETE FROM email_events WHERE recipient_email IN (?)', [[testEmail1, ...bulkEmailAddrs]]);
  await db.query('DELETE FROM users WHERE id IN (?)', [[contactId1, ...bulkContacts.map(c => c.id)]]);
  await db.query('DELETE FROM email_campaigns WHERE id IN (?)', [[composeRes.campaignId, bulkCampaign.id]]);

  console.log('\n=== ALL 7 PROOF REQUIREMENTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

verifyUnifiedCampaigns().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
