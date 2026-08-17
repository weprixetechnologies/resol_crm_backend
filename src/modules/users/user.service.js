const db = require('../../config/db');
const redis = require('../../config/redis');
const auditService = require('../audit/audit.service');
const { DuplicateUtil } = require('./duplicate.util');

class UserService {
  async createUser(payload, creatorId = null, creatorRole = 'public', overrideFuzzy = false) {
    const { name, email, mobile, city, state, designation, institute, department, region_type, country_code, remarks, status, tag1, tag2 } = payload;
    
    // Check duplicates
    const dupCheck = await DuplicateUtil.checkDuplicate({ email, mobile, name, city }, true);
    
    if (dupCheck.isDuplicate && dupCheck.user) {
      if (creatorRole === 'public') {
        const e = new Error('Customer Exist');
        e.statusCode = 409;
        e.code = 'CUSTOMER_EXISTS';
        e.matchedField = dupCheck.user.email_normalized === (email ? email.trim().toLowerCase() : null) ? 'email' : 'mobile';
        throw e;
      }

      const existingUser = dupCheck.user;
      let remarkText = remarks && remarks.trim() ? remarks.trim() : '';
      if (!remarkText) {
        remarkText = `Form resubmitted with details — Name: ${name || '-'}`;
        if (email) remarkText += `, Email: ${email}`;
        if (mobile) remarkText += `, Mobile: ${mobile}`;
        if (city) remarkText += `, City: ${city}`;
        if (institute) remarkText += `, Institute: ${institute}`;
      } else {
        remarkText = `Resubmitted remark: ${remarkText}`;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const formattedRemark = `[${dateStr} Resubmission]: ${remarkText}`;
      const updatedRemarks = existingUser.remarks 
        ? `${existingUser.remarks}\n${formattedRemark}`
        : formattedRemark;

      await db.query(
        'UPDATE users SET remarks = ?, updated_at = NOW() WHERE id = ?',
        [updatedRemarks, existingUser.id]
      );

      let remarkSource = 'staff_remark';
      if (creatorRole === 'admin_import') remarkSource = 'import';

      await db.query(
        `INSERT INTO user_queries (user_id, remark, source, created_by, is_duplicate_log) VALUES (?, ?, ?, ?, 1)`,
        [existingUser.id, remarkText, remarkSource, creatorId]
      );

      await auditService.log({
        actorId: creatorId,
        actorRole: creatorRole,
        action: 'USER_REMARK_ADDED',
        entityType: 'user',
        entityId: existingUser.id,
        meta: { isDuplicate: true, matchedField: existingUser.email_normalized === (email ? email.trim().toLowerCase() : null) ? 'email' : 'mobile' }
      });

      const resUser = await this.getUserById(existingUser.id);
      resUser.isExistingCustomer = true;
      return resUser;
    }

    if (dupCheck.possibleMatch && !overrideFuzzy) {
      const e = new Error('Possible fuzzy duplicate found');
      e.statusCode = 409;
      e.code = 'FUZZY_DUPLICATE';
      e.candidates = dupCheck.candidates;
      throw e;
    }

    const emailNorm = email ? email.trim().toLowerCase() : null;
    const mobileNorm = mobile ? mobile.replace(/\D/g, '') : null;
    let source = 'manual';
    if (creatorRole === 'public') source = 'public_form';
    else if (creatorRole === 'admin_import') source = 'import';
    
    const userStatus = (status && status.toString().toLowerCase() === 'unverified') ? 'unverified' : 'active';
    const tag1Val = tag1 ? tag1.toString().trim() : null;
    const tag2Val = tag2 ? tag2.toString().trim() : null;

    const [result] = await db.query(
      `INSERT INTO users (name, designation, department, institute, city, state, region_type, country_code, email, email_normalized, mobile, mobile_normalized, status, tag1, tag2, source, created_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, designation, department, institute, city, state, region_type, country_code, email, emailNorm, mobile, mobileNorm, userStatus, tag1Val, tag2Val, source, creatorId, remarks || null]
    );

    const newUserId = result.insertId;

    await auditService.log({
      actorId: creatorId,
      actorRole: creatorRole,
      action: 'USER_CREATE',
      entityType: 'user',
      entityId: newUserId,
      meta: { source }
    });

    return this.getUserById(newUserId);
  }

  async getUsers(page = 1, limit = 20, requesterRole = 'staff', requesterId = null, filters = {}) {
    const offset = (page - 1) * limit;
    let baseQuery = 'FROM users u LEFT JOIN staff s ON u.created_by = s.id WHERE 1=1';
    const params = [];

    // Apply Staff Scope
    if (requesterRole === 'staff') {
      const settingsStr = await redis.get('system_settings');
      let staffScope = 'all';
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        staffScope = settings.staff_scope || 'all';
      }
      
      if (staffScope === 'self_only' && requesterId) {
        baseQuery += ' AND u.created_by = ?';
        params.push(requesterId);
      }
    }

    // Apply Search
    if (filters.search) {
      baseQuery += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.tag1 LIKE ? OR u.tag2 LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    // Apply Advanced Filters
    const likeFields = ['city', 'state', 'institute', 'department', 'designation', 'tag1', 'tag2'];
    likeFields.forEach(field => {
      if (filters[field]) {
        baseQuery += ` AND u.${field} LIKE ?`;
        params.push(`%${filters[field]}%`);
      }
    });

    if (filters.staff_code) {
      baseQuery += ' AND s.staff_code LIKE ?';
      params.push(`%${filters.staff_code}%`);
    }

    const exactFields = ['source', 'region_type', 'status'];
    exactFields.forEach(field => {
      if (filters[field] && filters[field] !== 'all') {
        baseQuery += ` AND u.${field} = ?`;
        params.push(filters[field]);
      }
    });

    if (filters.is_admin_verified && filters.is_admin_verified !== 'all') {
      baseQuery += ' AND u.is_admin_verified = ?';
      params.push(filters.is_admin_verified === '1' ? 1 : 0);
    }

    if (filters.is_deletion_requested && filters.is_deletion_requested !== 'all') {
      baseQuery += ' AND u.is_deletion_requested = ?';
      params.push(filters.is_deletion_requested === '1' ? 1 : 0);
    }

    if (filters.startDate) {
      baseQuery += ' AND u.created_at >= ?';
      params.push(`${filters.startDate} 00:00:00`);
    }
    
    if (filters.endDate) {
      baseQuery += ' AND u.created_at <= ?';
      params.push(`${filters.endDate} 23:59:59`);
    }

    const [rows] = await db.query(`SELECT u.*, s.staff_code as created_by_code ${baseQuery} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total ${baseQuery}`, params);

    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  async getAllUsersForExport(requesterRole = 'staff', requesterId = null, filters = {}) {
    let baseQuery = 'FROM users u LEFT JOIN staff s ON u.created_by = s.id WHERE 1=1';
    const params = [];

    if (requesterRole === 'staff') {
      const settingsStr = await redis.get('system_settings');
      let staffScope = 'all';
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        staffScope = settings.staff_scope || 'all';
      }
      if (staffScope === 'self_only' && requesterId) {
        baseQuery += ' AND u.created_by = ?';
        params.push(requesterId);
      }
    }

    if (filters.search) {
      baseQuery += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.tag1 LIKE ? OR u.tag2 LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    const likeFields = ['city', 'state', 'institute', 'department', 'designation', 'tag1', 'tag2'];
    likeFields.forEach(field => {
      if (filters[field]) {
        baseQuery += ` AND u.${field} LIKE ?`;
        params.push(`%${filters[field]}%`);
      }
    });

    if (filters.staff_code) {
      baseQuery += ' AND s.staff_code LIKE ?';
      params.push(`%${filters.staff_code}%`);
    }

    const exactFields = ['source', 'region_type', 'status'];
    exactFields.forEach(field => {
      if (filters[field] && filters[field] !== 'all') {
        baseQuery += ` AND u.${field} = ?`;
        params.push(filters[field]);
      }
    });

    if (filters.is_admin_verified && filters.is_admin_verified !== 'all') {
      baseQuery += ' AND u.is_admin_verified = ?';
      params.push(filters.is_admin_verified === '1' ? 1 : 0);
    }

    if (filters.is_deletion_requested && filters.is_deletion_requested !== 'all') {
      baseQuery += ' AND u.is_deletion_requested = ?';
      params.push(filters.is_deletion_requested === '1' ? 1 : 0);
    }

    if (filters.startDate) {
      baseQuery += ' AND u.created_at >= ?';
      params.push(`${filters.startDate} 00:00:00`);
    }
    
    if (filters.endDate) {
      baseQuery += ' AND u.created_at <= ?';
      params.push(`${filters.endDate} 23:59:59`);
    }

    const [rows] = await db.query(`SELECT u.*, s.staff_code as created_by_code ${baseQuery} ORDER BY u.created_at DESC`, params);
    return rows;
  }

  async getUserById(id) {
    const [rows] = await db.query(`
      SELECT u.*, s.staff_code as created_by_code, s.name as created_by_name
      FROM users u
      LEFT JOIN staff s ON u.created_by = s.id
      WHERE u.id = ?
    `, [id]);
    if (rows.length === 0) {
      const e = new Error('User not found');
      e.statusCode = 404;
      throw e;
    }
    return rows[0];
  }

  async getUserTimeline(id) {
    const [rows] = await db.query(
      'SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC',
      ['user', id]
    );
    return rows;
  }

  async getUserRemarks(id) {
    const [rows] = await db.query(
      'SELECT q.*, s.name as created_by_name FROM user_queries q LEFT JOIN staff s ON q.created_by = s.id WHERE q.user_id = ? ORDER BY q.created_at DESC',
      [id]
    );
    return rows;
  }

  async addRemark(userId, remark, creatorId) {
    const [result] = await db.query(
      `INSERT INTO user_queries (user_id, remark, source, created_by) VALUES (?, ?, 'staff_remark', ?)`,
      [userId, remark, creatorId]
    );

    await auditService.log({
      actorId: creatorId,
      actorRole: 'staff',
      action: 'USER_REMARK_ADDED',
      entityType: 'user',
      entityId: userId,
      meta: { remarkId: result.insertId }
    });

    return result.insertId;
  }

  async updateUser(id, payload, updaterId, updaterRole) {
    // Determine allowed fields based on role
    const allowedFields = ['name', 'designation', 'department', 'institute', 'city', 'state', 'region_type', 'country_code', 'email', 'mobile', 'remarks', 'status', 'tag1', 'tag2'];
    if (updaterRole === 'admin') {
      allowedFields.push('is_admin_verified');
    }

    if (payload.status !== undefined) {
      payload.status = (payload.status && payload.status.toString().toLowerCase() === 'unverified') ? 'unverified' : 'active';
    }

    let query = 'UPDATE users SET updated_at = NOW()';
    const params = [];

    // Handle normalizations if email/mobile changed
    if (payload.email) {
      payload.email_normalized = payload.email.trim().toLowerCase();
      allowedFields.push('email_normalized');
    }
    if (payload.mobile) {
      payload.mobile_normalized = payload.mobile.replace(/\D/g, '');
      allowedFields.push('mobile_normalized');
    }

    const updates = {};
    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        query += `, ${field} = ?`;
        params.push(payload[field]);
        updates[field] = payload[field];
      }
    }

    if (params.length === 0) {
      return this.getUserById(id);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);

    await auditService.log({
      actorId: updaterId,
      actorRole: updaterRole,
      action: 'USER_UPDATE',
      entityType: 'user',
      entityId: id,
      meta: updates
    });

    return this.getUserById(id);
  }

  async requestDeletion(id, reason, requesterId, requesterRole) {
    const [result] = await db.query(
      'UPDATE users SET is_deletion_requested = 1, deletion_reason = ? WHERE id = ? AND is_deletion_requested = 0',
      [reason, id]
    );

    if (result.affectedRows === 0) {
      const e = new Error('User not found or deletion already requested');
      e.statusCode = 400;
      throw e;
    }

    await auditService.log({
      actorId: requesterId,
      actorRole: requesterRole,
      action: 'USER_DELETION_REQUEST',
      entityType: 'user',
      entityId: id,
      meta: { reason }
    });
  }

  async bulkRequestDeletion(ids, reason, requesterId, requesterRole) {
    if (!Array.isArray(ids) || ids.length === 0) {
      const e = new Error('No user IDs provided for deletion');
      e.statusCode = 400;
      throw e;
    }

    const [result] = await db.query(
      'UPDATE users SET is_deletion_requested = 1, deletion_reason = ? WHERE id IN (?) AND is_deletion_requested = 0',
      [reason, ids]
    );

    for (const id of ids) {
      await auditService.log({
        actorId: requesterId,
        actorRole: requesterRole,
        action: 'USER_DELETION_REQUEST',
        entityType: 'user',
        entityId: id,
        meta: { reason, isBulk: true }
      });
    }

    return { updatedCount: result.affectedRows };
  }
}

module.exports = new UserService();
