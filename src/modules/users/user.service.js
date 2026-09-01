const db = require('../../config/db');
const redis = require('../../config/redis');
const auditService = require('../audit/audit.service');
const { DuplicateUtil } = require('./duplicate.util');

class UserService {
  async createUser(payload, creatorId = null, creatorRole = 'public', overrideFuzzy = false) {
    const { name, email, mobile, city, state, designation, institute, department, country, region_type, country_code, remarks, status, tag1, tag2 } = payload;
    
    const countryVal = (country && country.trim()) ? country.trim() : ((region_type && region_type.trim()) ? region_type.trim() : null);

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

    const [[{ maxSl }]] = await db.query('SELECT MAX(sl_no) as maxSl FROM users');
    const nextSl = (maxSl || 0) + 1;

    const [result] = await db.query(
      `INSERT INTO users (sl_no, name, designation, department, institute, city, state, country, region_type, country_code, email, email_normalized, mobile, mobile_normalized, status, tag1, tag2, source, created_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextSl, name, designation, department, institute, city, state, countryVal, countryVal, country_code, email, emailNorm, mobile, mobileNorm, userStatus, tag1Val, tag2Val, source, creatorId, remarks || null]
    );

    const newUserId = result.insertId;

    await auditService.log({
      actorId: creatorId,
      actorRole: creatorRole,
      action: 'USER_CREATE',
      entityType: 'user',
      entityId: newUserId,
      meta: { source, sl_no: nextSl }
    });

    return this.getUserById(newUserId);
  }

  async syncSerialNumbers(connection = null) {
    const dbClient = connection || db;
    await dbClient.query('SET @seq = 0');
    await dbClient.query('UPDATE users SET sl_no = (@seq := @seq + 1) ORDER BY created_at ASC, id ASC');
    await dbClient.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('serial_sync_pending', 'false')
      ON DUPLICATE KEY UPDATE setting_value = 'false'
    `);
    await redis.del('system_settings');
  }

  async getUsers(page = 1, limit = 20, requesterRole = 'staff', requesterId = null, filters = {}) {
    const fromSNo = filters.fromSNo ? parseInt(filters.fromSNo, 10) : null;
    const toSNo = filters.toSNo ? parseInt(filters.toSNo, 10) : null;

    let offset = (page - 1) * limit;
    let queryLimit = limit;

    let isSyncPending = false;
    const settingsStr = await redis.get('system_settings');
    if (settingsStr) {
      const settings = JSON.parse(settingsStr);
      isSyncPending = settings.serial_sync_pending === true || settings.serial_sync_pending === 'true';
    } else {
      const [settingRows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'serial_sync_pending' LIMIT 1");
      if (settingRows.length > 0 && (settingRows[0].setting_value === 'true' || settingRows[0].setting_value === true)) {
        isSyncPending = true;
      }
    }

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
      baseQuery += ' AND (u.sl_no LIKE ? OR u.id LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.city LIKE ? OR u.state LIKE ? OR u.country LIKE ? OR u.institute LIKE ? OR u.department LIKE ? OR u.designation LIKE ? OR u.tag1 LIKE ? OR u.tag2 LIKE ? OR s.staff_code LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term, term, term, term, term, term, term, term, term, term);
    }

    // Apply Serial Range (sl_no)
    if (fromSNo && !isNaN(fromSNo) && fromSNo > 0) {
      baseQuery += ' AND COALESCE(u.sl_no, u.id) >= ?';
      params.push(fromSNo);
    }
    if (toSNo && !isNaN(toSNo) && toSNo > 0) {
      baseQuery += ' AND COALESCE(u.sl_no, u.id) <= ?';
      params.push(toSNo);
    }

    // Apply Advanced Filters
    const likeFields = ['city', 'state', 'country', 'institute', 'department', 'designation', 'tag1', 'tag2'];
    likeFields.forEach(field => {
      if (filters[field]) {
        baseQuery += ` AND (u.${field} LIKE ? ${field === 'country' ? 'OR u.region_type LIKE ?' : ''})`;
        params.push(`%${filters[field]}%`);
        if (field === 'country') params.push(`%${filters[field]}%`);
      }
    });

    if (filters.staff_code) {
      baseQuery += ' AND s.staff_code LIKE ?';
      params.push(`%${filters.staff_code}%`);
    }

    const exactFields = ['source', 'status'];
    exactFields.forEach(field => {
      if (filters[field] && filters[field] !== 'all') {
        baseQuery += ` AND u.${field} = ?`;
        params.push(filters[field]);
      }
    });

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

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total ${baseQuery}`, params);

    if (queryLimit <= 0) {
      return { items: [], total, page, totalPages: Math.ceil(total / limit) || 1, isSyncPending: !!isSyncPending };
    }

    const [rows] = await db.query(`SELECT u.*, s.staff_code as created_by_code ${baseQuery} ORDER BY u.sl_no DESC, u.id DESC LIMIT ? OFFSET ?`, [...params, queryLimit, offset]);

    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      isSyncPending: !!isSyncPending
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
      baseQuery += ' AND (u.sl_no LIKE ? OR u.id LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR u.city LIKE ? OR u.state LIKE ? OR u.country LIKE ? OR u.institute LIKE ? OR u.department LIKE ? OR u.designation LIKE ? OR u.tag1 LIKE ? OR u.tag2 LIKE ? OR s.staff_code LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term, term, term, term, term, term, term, term, term, term);
    }

    const fromSNo = filters.fromSNo ? parseInt(filters.fromSNo, 10) : null;
    const toSNo = filters.toSNo ? parseInt(filters.toSNo, 10) : null;

    if (fromSNo && !isNaN(fromSNo) && fromSNo > 0) {
      baseQuery += ' AND COALESCE(u.sl_no, u.id) >= ?';
      params.push(fromSNo);
    }
    if (toSNo && !isNaN(toSNo) && toSNo > 0) {
      baseQuery += ' AND COALESCE(u.sl_no, u.id) <= ?';
      params.push(toSNo);
    }

    const likeFields = ['city', 'state', 'country', 'institute', 'department', 'designation', 'tag1', 'tag2'];
    likeFields.forEach(field => {
      if (filters[field]) {
        baseQuery += ` AND (u.${field} LIKE ? ${field === 'country' ? 'OR u.region_type LIKE ?' : ''})`;
        params.push(`%${filters[field]}%`);
        if (field === 'country') params.push(`%${filters[field]}%`);
      }
    });

    if (filters.staff_code) {
      baseQuery += ' AND s.staff_code LIKE ?';
      params.push(`%${filters.staff_code}%`);
    }

    const exactFields = ['source', 'status'];
    exactFields.forEach(field => {
      if (filters[field] && filters[field] !== 'all') {
        baseQuery += ` AND u.${field} = ?`;
        params.push(filters[field]);
      }
    });

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

    const [rows] = await db.query(`SELECT u.*, s.staff_code as created_by_code ${baseQuery} ORDER BY u.sl_no DESC, u.id DESC`, params);
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
    const allowedFields = ['name', 'designation', 'department', 'institute', 'city', 'state', 'country', 'region_type', 'country_code', 'email', 'mobile', 'remarks', 'status', 'tag1', 'tag2'];

    if (payload.status !== undefined) {
      payload.status = (payload.status && payload.status.toString().toLowerCase() === 'unverified') ? 'unverified' : 'active';
    }

    if (payload.country !== undefined || payload.region_type !== undefined) {
      const cVal = (payload.country || payload.region_type || '').trim() || null;
      payload.country = cVal;
      payload.region_type = cVal;
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
      action: 'USER_DELETION_REQUESTED',
      entityType: 'user',
      entityId: id,
      meta: { reason }
    });

    return { success: true };
  }

  async bulkRequestDeletion(ids, reason, requesterId, requesterRole) {
    const [result] = await db.query(
      'UPDATE users SET is_deletion_requested = 1, deletion_reason = ? WHERE id IN (?) AND is_deletion_requested = 0',
      [reason, ids]
    );

    await auditService.log({
      actorId: requesterId,
      actorRole: requesterRole,
      action: 'USER_BULK_DELETION_REQUESTED',
      entityType: 'users',
      meta: { count: result.affectedRows, requestedIds: ids, reason }
    });

    return { updatedCount: result.affectedRows };
  }

  async getEmailActivity(userId) {
    const user = await this.getUserById(userId);
    const userEmail = user.email ? user.email.toLowerCase().trim() : null;

    const [logs] = await db.query(
      `SELECT l.*, s.name as sent_by_name
       FROM email_logs l
       LEFT JOIN staff s ON l.sent_by = s.id
       WHERE l.user_id = ? OR (LOWER(l.recipient_email) = ? AND ? IS NOT NULL)
       ORDER BY l.created_at DESC`,
      [userId, userEmail, userEmail]
    );

    const [campaignParticipations] = await db.query(
      `SELECT cr.*, ec.name as campaign_name, ec.subject as campaign_subject
       FROM campaign_recipients cr
       JOIN email_campaigns ec ON cr.campaign_id = ec.id
       WHERE cr.contact_id = ? OR (LOWER(cr.email_address) = ? AND ? IS NOT NULL)
       ORDER BY cr.created_at DESC`,
      [userId, userEmail, userEmail]
    );

    const [events] = await db.query(
      `SELECT ee.*, ec.name as campaign_name
       FROM email_events ee
       LEFT JOIN email_campaigns ec ON ee.campaign_id = ec.id
       WHERE ee.contact_id = ? OR (LOWER(ee.recipient_email) = ? AND ? IS NOT NULL)
       ORDER BY ee.event_at DESC`,
      [userId, userEmail, userEmail]
    );

    const [messages] = await db.query(
      `SELECT m.*, c.subject as conversation_subject
       FROM email_messages m
       LEFT JOIN email_conversations c ON m.conversation_id = c.id
       WHERE m.contact_id = ? OR (LOWER(m.from_email) = ? AND ? IS NOT NULL) OR (LOWER(m.to_email) = ? AND ? IS NOT NULL)
       ORDER BY m.received_at DESC`,
      [userId, userEmail, userEmail, userEmail, userEmail]
    );

    return {
      user: { id: user.id, name: user.name, email: user.email },
      logs,
      campaigns: campaignParticipations,
      events,
      messages
    };
  }

  async validateUserEmail(userId) {
    const user = await this.getUserById(userId);
    if (!user.email) {
      const err = new Error('Customer has no email address');
      err.statusCode = 400;
      throw err;
    }

    const msg91Provider = require('../../integrations/email/msg91.provider');
    const valRes = await msg91Provider.validateEmails([user.email]);
    const itemResult = valRes.results && valRes.results[0] ? valRes.results[0] : null;

    if (itemResult) {
      await db.query(
        `UPDATE users SET email_validation_status = ?, email_validation_reason = ?, email_validated_at = NOW() WHERE id = ?`,
        [itemResult.resultStatus, itemResult.reason, userId]
      );
    }

    return {
      userId,
      email: user.email,
      validation: itemResult
    };
  }

  async bulkValidateUserEmails(userIds = [], validateAllUnvalidated = false, mode = 'do_now') {
    let users = [];

    if (Array.isArray(userIds) && userIds.length > 0) {
      const [rows] = await db.query(
        `SELECT id, email FROM users WHERE id IN (?) AND email IS NOT NULL AND email != ''`,
        [userIds]
      );
      users = rows;
    } else if (validateAllUnvalidated) {
      const [rows] = await db.query(
        `SELECT id, email FROM users WHERE email IS NOT NULL AND email != '' AND (email_validation_status IS NULL OR email_validation_status = '' OR email_validation_status = 'unknown') LIMIT 100`
      );
      users = rows;
    }

    if (users.length === 0) {
      return { totalValidated: 0, results: [], message: 'No unvalidated email addresses found.' };
    }

    if (mode === 'background') {
      setImmediate(async () => {
        const msg91Provider = require('../../integrations/email/msg91.provider');
        for (const u of users) {
          try {
            const itemResult = await msg91Provider.validateSingleEmail(u.email);
            if (itemResult) {
              await db.query(
                `UPDATE users SET email_validation_status = ?, email_validation_reason = ?, email_validated_at = NOW() WHERE id = ?`,
                [itemResult.resultStatus, itemResult.reason, u.id]
              );
            }
          } catch (err) {
            console.error(`[Background Validation Error] User #${u.id} (${u.email}):`, err.message);
          }
        }
      });

      return {
        isBackground: true,
        totalValidated: users.length,
        message: `Validation queued! ${users.length} customer email(s) will be validated in the background soon.`
      };
    }

    const msg91Provider = require('../../integrations/email/msg91.provider');
    const results = [];

    for (const u of users) {
      try {
        const itemResult = await msg91Provider.validateSingleEmail(u.email);
        if (itemResult) {
          await db.query(
            `UPDATE users SET email_validation_status = ?, email_validation_reason = ?, email_validated_at = NOW() WHERE id = ?`,
            [itemResult.resultStatus, itemResult.reason, u.id]
          );
          results.push(itemResult);
        }
      } catch (err) {
        results.push({ email: u.email, valid: false, resultStatus: 'unknown', reason: err.message });
      }
    }

    return {
      isBackground: false,
      totalValidated: users.length,
      results,
      message: `Bulk validated ${users.length} customer email(s) via MSG91.`
    };
  }
}

module.exports = new UserService();
