const dashboardService = require('./dashboard.service');
const ApiResponse = require('../../utils/apiResponse');

class DashboardController {
  async getStats(req, res) {
    const range = req.query.range || '7d';
    const contactValue = parseInt(req.query.contactValue || req.query.value) || 24;
    const contactUnit = (req.query.contactUnit || req.query.unit || 'hours').toLowerCase();
    const stats = await dashboardService.getStats(req.user, range, { contactValue, contactUnit });
    res.json(ApiResponse.success(stats));
  }

  async getAuditLogs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    
    const logs = await dashboardService.getAuditLogs(page, limit);
    res.json(ApiResponse.success(logs));
  }
}

module.exports = new DashboardController();
