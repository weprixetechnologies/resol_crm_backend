const userService = require('./user.service');
const ApiResponse = require('../../utils/apiResponse');

class UserController {
  async createUser(req, res) {
    const overrideFuzzy = req.body.overrideFuzzy === true;
    const user = await userService.createUser(req.body, req.user.id, req.user.role, overrideFuzzy);
    res.status(201).json(ApiResponse.success(user, 'User created successfully'));
  }

  async getUsers(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filters = { 
      search: req.query.search,
      city: req.query.city,
      state: req.query.state,
      institute: req.query.institute,
      department: req.query.department,
      designation: req.query.designation,
      source: req.query.source,
      region_type: req.query.region_type,
      is_admin_verified: req.query.is_admin_verified,
      is_deletion_requested: req.query.is_deletion_requested,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    
    const result = await userService.getUsers(page, limit, req.user.role, req.user.id, filters);
    res.json(ApiResponse.success(result));
  }

  async getUserById(req, res) {
    const user = await userService.getUserById(req.params.id);
    const timeline = await userService.getUserTimeline(req.params.id);
    const remarks = await userService.getUserRemarks(req.params.id);
    res.json(ApiResponse.success({ user, timeline, remarks }));
  }

  async updateUser(req, res) {
    const user = await userService.updateUser(req.params.id, req.body, req.user.id, req.user.role);
    res.json(ApiResponse.success(user, 'User updated successfully'));
  }

  async requestDeletion(req, res) {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Reason is required for deletion'));
    }
    await userService.requestDeletion(req.params.id, reason, req.user.id, req.user.role);
    res.json(ApiResponse.success(null, 'Deletion requested successfully'));
  }

  async addRemark(req, res) {
    const { remark } = req.body;
    if (!remark) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Remark text is required'));
    }
    await userService.addRemark(req.params.id, remark, req.user.id);
    res.json(ApiResponse.success(null, 'Remark added successfully'));
  }
}

module.exports = new UserController();
