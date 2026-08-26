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

  /**
   * @deprecated UNIFIED CAMPAIGN ARCHITECTURE: Do not call sendTransactional.
   * All dispatches (1 recipient or N recipients) must use sendCampaign.
   */
  async sendTransactional(options) {
    console.warn('[GMassProvider DEPRECATED] sendTransactional called. All sends must use sendCampaign.');
    const env = require('../../../config/env');
    const fromEmail = options.from || env.SMTP_FROM_EMAIL || 'vishal0077@gmail.com';
    const fromName = options.fromName || env.SMTP_FROM_NAME || 'Resol Global';

    const webhookSecret = env.GMASS_WEBHOOK_SECRET || 'gmass_crm_secret_2026';
    const defaultWebhookUrl = `https://apicrm.cursiveletters.in/api/webhooks/gmass?secret=${webhookSecret}`;

    const payload = {
      to: options.to,
      emailAddress: options.to,
      fromEmail,
      fromName,
      subject: options.subject,
      html: options.html,
      message: options.html,
      openTrack: true,
      clickTrack: true,
      openTracking: true,
      clickTracking: true,
      trackOpens: true,
      trackClicks: true,
      webhookUrl: options.webhookUrl || defaultWebhookUrl,
      webhook: options.webhookUrl || defaultWebhookUrl,
      ...(options.campaignIdToReplyTo ? { campaignIdToReplyTo: options.campaignIdToReplyTo } : {})
    };

    const response = await this.client.sendTransactional(payload);
    return {
      success: true,
      provider: 'gmass-deprecated-transactional',
      response
    };
  }

  async sendCampaign(campaign) {
    const env = require('../../../config/env');
    const webhookSecret = env.GMASS_WEBHOOK_SECRET || 'gmass_crm_secret_2026';
    const defaultWebhookUrl = `https://apicrm.cursiveletters.in/api/webhooks/gmass?secret=${webhookSecret}`;

    const { subject, bodyHtml, recipients, options = {} } = campaign;
    const emailAddresses = recipients.map(r => r.email).join(',');

    const draftPayload = {
      subject,
      message: bodyHtml,
      emailAddresses
    };

    let draftRes = null;
    let draftId = null;
    try {
      draftRes = await this.client.createDraft(draftPayload);
      draftId = draftRes ? (draftRes.campaignDraftId || draftRes.draftId || draftRes.id) : null;
    } catch (dErr) {
      console.warn('[GMass Provider] Draft creation warning:', dErr.message);
    }

    const campaignOptions = {
      openTracking: options.openTracking !== false,
      clickTracking: options.clickTracking !== false,
      trackOpens: true,
      trackClicks: true,
      webhookUrl: options.webhookUrl || defaultWebhookUrl,
      webhook: options.webhookUrl || defaultWebhookUrl,
      ...options
    };

    let campaignResponse = null;
    try {
      campaignResponse = await this.client.sendCampaign(draftId, campaignOptions);
    } catch (cErr) {
      console.warn('[GMass Provider] Campaign launch response:', cErr.message);
      campaignResponse = {
        campaignId: draftId || null,
        status: 'queued_in_gmass',
        message: cErr.message
      };
    }

    const gmassCampaignId = campaignResponse.campaignId || campaignResponse.CampaignID || campaignResponse.id || campaignResponse.campaign_id || draftId;

    return {
      success: true,
      provider: 'gmass',
      gmassDraftId: draftId ? String(draftId) : null,
      gmassCampaignId: gmassCampaignId ? String(gmassCampaignId) : null,
      response: campaignResponse
    };
  }
}

module.exports = new GMassProvider();
