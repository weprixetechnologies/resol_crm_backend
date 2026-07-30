const staffService = require('./staff.service');
const ApiResponse = require('../../utils/apiResponse');

class StaffController {
  async createStaff(req, res) {
    const staff = await staffService.createStaff(req.body, req.user.id);
    res.status(201).json(ApiResponse.success(staff, 'Staff created successfully'));
  }

  async getStaffList(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const result = await staffService.getStaffList(page, limit);
    res.json(ApiResponse.success(result));
  }

  async getStaffById(req, res) {
    const staff = await staffService.getStaffById(req.params.id);
    res.json(ApiResponse.success(staff));
  }

  async updateStaff(req, res) {
    const staff = await staffService.updateStaff(req.params.id, req.body, req.user.id);
    res.json(ApiResponse.success(staff, 'Staff updated successfully'));
  }

  async deleteStaff(req, res) {
    await staffService.deleteStaff(req.params.id, req.user.id);
    res.json(ApiResponse.success(null, 'Staff deleted successfully'));
  }
}

module.exports = new StaffController();
