const db = require('../src/config/db');
const gmassWebhookProcessor = require('../src/integrations/email/gmass/gmass.webhook');
const campaignService = require('../src/modules/campaigns/campaign.service');
const userService = require('../src/modules/users/user.service');

async function testGMassIntegration() {
  console.log('=== Starting GMass Integration End-to-End Verification ===\n');

  try {
    // 1. Create a test contact in users table
    const testEmail = `test.lead.${Date.now()}@example.com`;
    const [userRes] = await db.query(
      `INSERT INTO users (name, email, email_normalized, status, source)
       VALUES ('GMass Test Lead', ?, ?, 'active', 'manual')`,
      [testEmail, testEmail.toLowerCase()]
    );
    const testContactId = userRes.insertId;
    console.log(`✓ 1. Test contact created: ID ${testContactId} (${testEmail})`);

    // 2. Create a test campaign draft
    const campaign = await campaignService.createCampaign({
      name: 'Integration Test Campaign',
      subject: 'Test Subject Hello {{name}}',
      bodyHtml: '<p>Hello {{name}}, this is a test.</p>'
    }, 1);
    console.log(`✓ 2. Campaign created: ID ${campaign.id} (${campaign.name})`);

    // 3. Attach recipient to campaign
    const recResult = await campaignService.addRecipients(campaign.id, {
      contactIds: [testContactId]
    });
    console.log(`✓ 3. Recipient attached: ${recResult.addedCount} added (Total: ${recResult.totalRecipients})`);

    // Manually set gmass_campaign_id for testing webhook matching
    const mockGMassCampaignId = `MOCK-CAMP-${Date.now()}`;
    await db.query(`UPDATE email_campaigns SET gmass_campaign_id = ?, status = 'sent' WHERE id = ?`, [mockGMassCampaignId, campaign.id]);

    const testSecret = process.env.GMASS_WEBHOOK_SECRET || 'gmass_crm_secret_2026';
    const queryParams = { secret: testSecret };

    // 4. Test Webhook: Send event
    const sendWebhook = await gmassWebhookProcessor.processEvent({
      CampaignID: mockGMassCampaignId,
      Email: testEmail,
      Event: 'Send',
      Timestamp: new Date().toISOString()
    }, queryParams);
    console.log('✓ 4. Send Webhook processed:', sendWebhook);

    // 5. Test Webhook: Open event -> expect lead_status = 'Engaged'
    await gmassWebhookProcessor.processEvent({
      campaign_id: mockGMassCampaignId,
      emailAddress: testEmail,
      eventType: 'Open',
      timestamp: new Date().toISOString()
    }, queryParams);
    let contactState = await userService.getUserById(testContactId);
    console.log(`✓ 5. Open Webhook processed -> Lead Status: "${contactState.lead_status}" (Expected: "Engaged")`);
    if (contactState.lead_status !== 'Engaged') throw new Error('Expected lead_status Engaged');

    // 6. Test Webhook: Click event -> expect lead_status = 'Hot Lead'
    await gmassWebhookProcessor.processEvent({
      CampaignId: mockGMassCampaignId,
      email: testEmail,
      event: 'Click',
      url: 'https://example.com/demo',
      timestamp: new Date().toISOString()
    }, queryParams);
    contactState = await userService.getUserById(testContactId);
    console.log(`✓ 6. Click Webhook processed -> Lead Status: "${contactState.lead_status}" (Expected: "Hot Lead")`);
    if (contactState.lead_status !== 'Hot Lead') throw new Error('Expected lead_status Hot Lead');

    // 7. Test Webhook: Reply event -> expect lead_status = 'Conversation Started' & stop_automated_followups = 1
    await gmassWebhookProcessor.processEvent({
      campaignId: mockGMassCampaignId,
      email: testEmail,
      type: 'Reply',
      timestamp: new Date().toISOString()
    }, queryParams);
    contactState = await userService.getUserById(testContactId);
    console.log(`✓ 7. Reply Webhook processed -> Lead Status: "${contactState.lead_status}", Followups Stopped: ${contactState.stop_automated_followups}`);
    if (contactState.lead_status !== 'Conversation Started' || !contactState.stop_automated_followups) {
      throw new Error('Expected Conversation Started and stop_automated_followups = 1');
    }

    // 8. Test Contact Email Activity API endpoint query
    const activity = await userService.getEmailActivity(testContactId);
    console.log(`✓ 8. Contact Email Activity retrieved: ${activity.events.length} event(s) recorded.`);

    // 9. Clean up test records
    await db.query('DELETE FROM email_events WHERE contact_id = ?', [testContactId]);
    await db.query('DELETE FROM campaign_recipients WHERE campaign_id = ?', [campaign.id]);
    await db.query('DELETE FROM email_campaigns WHERE id = ?', [campaign.id]);
    await db.query('DELETE FROM users WHERE id = ?', [testContactId]);
    console.log('✓ 9. Test cleanup complete.');

    console.log('\n=== ALL GMASS INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
  } finally {
    process.exit(0);
  }
}

testGMassIntegration();
