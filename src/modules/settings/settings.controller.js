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
}

module.exports = new SettingsController();
