const settingsService = require('./settings.service');
const ApiResponse = require('../../utils/apiResponse');

class SettingsController {
  async getSettings(req, res) {
    const settings = await settingsService.getSettings();
    res.json(ApiResponse.success(settings));
  }

  async updateSettings(req, res) {
    const settings = await settingsService.updateSettings(req.body, req.user.id);
    res.json(ApiResponse.success(settings, 'Settings updated successfully'));
  }

  async testSmtpConnection(req, res) {
    const nodemailerProvider = require('../../integrations/email/nodemailer.provider');
    const result = await nodemailerProvider.verifyConnection(req.body);
    res.json(ApiResponse.success(result, 'SMTP Connection test succeeded!'));
  }

  async testMsg91Connection(req, res) {
    const { msg91Provider } = require('../../integrations/email');
    const result = await msg91Provider.verifyConnection(req.body);
    res.json(ApiResponse.success(result, 'MSG91 API Connection test succeeded!'));
  }
}

module.exports = new SettingsController();
