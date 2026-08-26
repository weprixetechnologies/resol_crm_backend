const mailService = require('./mail.service');
const ApiResponse = require('../../utils/apiResponse');

class MailController {
  async testConnection(req, res) {
    const result = await mailService.testConnection(req.body);
    res.json(ApiResponse.success(result, 'GMass Connection test succeeded!'));
  }

  async testGMassConnection(req, res) {
    const apiKey = req.body?.gmass_api_key || null;
    const result = await mailService.testGMassConnection(apiKey);
    res.json(ApiResponse.success(result, 'GMass Connection test succeeded!'));
  }

  async getTemplates(req, res) {
    const templates = await mailService.getTemplates();
    res.json(ApiResponse.success(templates));
  }

  async getTemplateById(req, res) {
    const template = await mailService.getTemplateById(req.params.id);
    res.json(ApiResponse.success(template));
  }

  async createTemplate(req, res) {
    const template = await mailService.createTemplate(req.body, req.user.id);
    res.status(201).json(ApiResponse.success(template, 'Template created successfully'));
  }

  async updateTemplate(req, res) {
    const template = await mailService.updateTemplate(req.params.id, req.body, req.user.id);
    res.json(ApiResponse.success(template, 'Template updated successfully'));
  }

  async deleteTemplate(req, res) {
    const result = await mailService.deleteTemplate(req.params.id, req.user.id);
    res.json(ApiResponse.success(result, 'Template deleted successfully'));
  }

  async sendMail(req, res) {
    const result = await mailService.sendMail(req.body, req.user.id);
    res.json(ApiResponse.success(result, result.message || 'Mails queued for BullMQ background processing!'));
  }

  async getQueueStatus(req, res) {
    const status = await mailService.getQueueStatus();
    res.json(ApiResponse.success(status));
  }

  async getLogs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const logs = await mailService.getLogs(page, limit, search);
    res.json(ApiResponse.success(logs));
  }
}

module.exports = new MailController();
