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

  async testGMassConnection(req, res) {
    const mailService = require('../mail/mail.service');
    const apiKey = req.body?.gmass_api_key || null;
    const result = await mailService.testGMassConnection(apiKey);
    res.json(ApiResponse.success(result, 'GMass API Connection test succeeded!'));
  }
}

module.exports = new SettingsController();
