const db = require('../src/config/db');
const campaignService = require('../src/modules/campaigns/campaign.service');
const GMassClient = require('../src/integrations/email/gmass/gmass.client');

async function sendLiveTestEmail() {
  const targetEmail = 'ronitsarkar.dev@gmail.com';
  console.log(`=== Sending Live GMass Test Email to ${targetEmail} ===\n`);

  try {
    // 1. Create a campaign draft in CRM DB
    const campaign = await campaignService.createCampaign({
      name: `Live Test Campaign - ${new Date().toISOString()}`,
      subject: 'RESOL CRM Live GMass Integration Test',
      bodyHtml: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4F46E5;">RESOL CRM + GMass Live Test</h2>
          <p>Hello Ronit,</p>
          <p>This is a live test email dispatched directly from your <strong>RESOL CRM</strong> backend using the <strong>GMass API</strong>.</p>
          <p>Tracking features enabled:</p>
          <ul>
            <li>Open Tracking</li>
            <li>Click Tracking: <a href="https://gmass.co" style="color: #4F46E5;">Click here to test link tracking</a></li>
          </ul>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="font-size: 12px; color: #6B7280;">Sent via RESOL CRM GMass Integration Engine</p>
        </div>
      `
    }, 1);

    console.log(`✓ 1. Campaign record created in DB: ID #${campaign.id}`);

    // 2. Add recipient
    await campaignService.addRecipients(campaign.id, {
      customEmails: [{ email: targetEmail, name: 'Ronit Sarkar' }]
    });

    console.log(`✓ 2. Recipient added: ${targetEmail}`);

    // 3. Send campaign via GMass API
    console.log('Sending dispatch via GMass API...');
    const result = await campaignService.sendCampaign(campaign.id, 1);

    console.log('\n=== LIVE EMAIL SENT SUCCESSFULLY! ===');
    console.log('Campaign ID:', result.campaignId);
    console.log('GMass Draft ID:', result.gmassDraftId);
    console.log('GMass Campaign ID:', result.gmassCampaignId);
    console.log('Recipient Count:', result.recipientCount);
  } catch (err) {
    console.error('\n❌ Live send failed:', err.message || err);
    if (err.responseBody) {
      console.error('GMass Error Details:', JSON.stringify(err.responseBody, null, 2));
    }
  } finally {
    process.exit(0);
  }
}

sendLiveTestEmail();
