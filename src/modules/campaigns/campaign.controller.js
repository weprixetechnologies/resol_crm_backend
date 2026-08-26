const campaignService = require('./campaign.service');
const ApiResponse = require('../../utils/apiResponse');

class CampaignController {
  async createCampaign(req, res) {
    const campaign = await campaignService.createCampaign(req.body, req.user.id);
    res.status(201).json(ApiResponse.success(campaign, 'Campaign created successfully'));
  }

  async getCampaigns(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const data = await campaignService.getCampaigns(page, limit);
    res.json(ApiResponse.success(data));
  }

  async getCampaignById(req, res) {
    const campaign = await campaignService.getCampaignById(req.params.id);
    res.json(ApiResponse.success(campaign));
  }

  async addRecipients(req, res) {
    const result = await campaignService.addRecipients(req.params.id, req.body);
    res.json(ApiResponse.success(result, 'Recipients added to campaign successfully'));
  }

  async removeRecipient(req, res) {
    const result = await campaignService.removeRecipient(req.params.id, req.params.contactId);
    res.json(ApiResponse.success(result, 'Recipient removed successfully'));
  }

  async sendCampaign(req, res) {
    const result = await campaignService.sendCampaign(req.params.id, req.user.id);
    res.json(ApiResponse.success(result, 'Campaign dispatch triggered successfully'));
  }

  async scheduleCampaign(req, res) {
    const { sendTime } = req.body;
    const result = await campaignService.scheduleCampaign(req.params.id, sendTime, req.user.id);
    res.json(ApiResponse.success(result, 'Campaign scheduled successfully'));
  }

  async getAnalytics(req, res) {
    const analytics = await campaignService.getAnalytics(req.params.id);
    res.json(ApiResponse.success(analytics));
  }

  async syncCampaign(req, res) {
    const result = await campaignService.syncCampaignFromGMass(req.params.id);
    res.json(ApiResponse.success(result, 'Campaign synced from GMass API successfully'));
  }

  async syncAllCampaigns(req, res) {
    const result = await campaignService.syncAllCampaignsFromGMass();
    res.json(ApiResponse.success(result, 'All GMass campaign reports synced successfully'));
  }

  async getGlobalTrackingSummary(req, res) {
    const summary = await campaignService.getGlobalTrackingSummary();
    res.json(ApiResponse.success(summary));
  }
}

module.exports = new CampaignController();
