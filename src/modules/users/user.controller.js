const userService = require('./user.service');
const ApiResponse = require('../../utils/apiResponse');
const ExcelJS = require('exceljs');

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
      status: req.query.status,
      tag1: req.query.tag1,
      tag2: req.query.tag2,
      is_admin_verified: req.query.is_admin_verified,
      is_deletion_requested: req.query.is_deletion_requested,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    
    const result = await userService.getUsers(page, limit, req.user.role, req.user.id, filters);
    res.json(ApiResponse.success(result));
  }

  async exportUsers(req, res) {
    const filters = { 
      search: req.query.search,
      city: req.query.city,
      state: req.query.state,
      institute: req.query.institute,
      department: req.query.department,
      designation: req.query.designation,
      source: req.query.source,
      region_type: req.query.region_type,
      status: req.query.status,
      tag1: req.query.tag1,
      tag2: req.query.tag2,
      is_admin_verified: req.query.is_admin_verified,
      is_deletion_requested: req.query.is_deletion_requested,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const users = await userService.getAllUsersForExport(req.user.role, req.user.id, filters);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customer Data');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Tag 1', key: 'tag1', width: 20 },
      { header: 'Tag 2', key: 'tag2', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Mobile', key: 'mobile', width: 20 },
      { header: 'ISD Code', key: 'country_code', width: 12 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Institute', key: 'institute', width: 25 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Region Type', key: 'region_type', width: 15 },
      { header: 'Source', key: 'source', width: 15 },
      { header: 'Staff Code', key: 'created_by_code', width: 15 },
      { header: 'Admin Verified', key: 'is_admin_verified', width: 15 },
      { header: 'Deletion Requested', key: 'is_deletion_requested', width: 20 },
      { header: 'Remarks', key: 'remarks', width: 30 },
      { header: 'Created At', key: 'created_at', width: 22 }
    ];

    users.forEach(u => {
      worksheet.addRow({
        id: u.id,
        name: u.name,
        status: u.status || 'active',
        tag1: u.tag1 || '',
        tag2: u.tag2 || '',
        email: u.email || '',
        mobile: u.mobile || '',
        country_code: u.country_code || '',
        city: u.city || '',
        state: u.state || '',
        designation: u.designation || '',
        institute: u.institute || '',
        department: u.department || '',
        region_type: u.region_type || '',
        source: u.source || '',
        created_by_code: u.created_by_code || '',
        is_admin_verified: u.is_admin_verified === 1 ? 'Yes' : 'No',
        is_deletion_requested: u.is_deletion_requested === 1 ? 'Yes' : 'No',
        remarks: u.remarks || '',
        created_at: u.created_at ? new Date(u.created_at).toISOString().replace('T', ' ').substring(0, 19) : ''
      });
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' }
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer_data_export.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
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

  async bulkRequestDeletion(req, res) {
    const { ids, reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Reason/Remarks are required for deletion request'));
    }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Please select at least one customer for deletion'));
    }
    const result = await userService.bulkRequestDeletion(ids, reason.trim(), req.user.id, req.user.role);
    res.json(ApiResponse.success(result, `Deletion requested for ${result.updatedCount} customer(s).`));
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
