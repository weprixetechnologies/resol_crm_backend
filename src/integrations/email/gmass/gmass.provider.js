const EmailProvider = require('../email-provider.interface');
const GMassClient = require('./gmass.client');

class GMassProvider extends EmailProvider {
  constructor() {
    super();
    this.client = new GMassClient();
  }

  async verifyConnection() {
    try {
      // GMass API verify check by calling campaigns list with limit=1
      await this.client.getCampaigns(1, 0);
      return { success: true, message: 'GMass API connection verified successfully!' };
    } catch (err) {
      return { success: false, message: err.message || 'Failed to verify GMass API connection' };
    }
  }

  async sendTransactional(options) {
    const env = require('../../../config/env');
    const fromEmail = options.from || env.SMTP_FROM_EMAIL || 'vishal0077@gmail.com';
    const fromName = options.fromName || env.SMTP_FROM_NAME || 'Resol Global';

    const payload = {
      to: options.to,
      emailAddress: options.to,
      fromEmail,
      fromName,
      subject: options.subject,
      html: options.html,
      message: options.html,
      ...(options.campaignIdToReplyTo ? { campaignIdToReplyTo: options.campaignIdToReplyTo } : {})
    };

    const response = await this.client.sendTransactional(payload);
    return {
      success: true,
      provider: 'gmass',
      response
    };
  }

  async sendCampaign(campaign) {
    const { subject, bodyHtml, recipients, options = {} } = campaign;
    const emailAddresses = recipients.map(r => r.email).join(',');

    const campaignPayload = {
      subject,
      message: bodyHtml,
      emailAddresses,
      openTracking: options.openTracking !== false,
      clickTracking: options.clickTracking !== false,
      ...options
    };

    try {
      const campaignResponse = await this.client.sendCampaign(null, campaignPayload);
      const gmassCampaignId = campaignResponse.campaignId || campaignResponse.CampaignID || campaignResponse.id || campaignResponse.campaign_id;

      return {
        success: true,
        provider: 'gmass',
        gmassDraftId: campaignResponse.draftId ? String(campaignResponse.draftId) : null,
        gmassCampaignId: gmassCampaignId ? String(gmassCampaignId) : null,
        response: campaignResponse
      };
    } catch (err) {
      console.warn('[GMass Provider] Campaign endpoint dispatch fallback to transactional route:', err.message);
      
      const results = [];
      for (const recipient of recipients) {
        const txRes = await this.sendTransactional({
          to: recipient.email,
          subject,
          html: bodyHtml
        });
        results.push(txRes);
      }

      return {
        success: true,
        provider: 'gmass-transactional-fallback',
        gmassCampaignId: null,
        recipientCount: recipients.length,
        results
      };
    }
  }
}

module.exports = new GMassProvider();
