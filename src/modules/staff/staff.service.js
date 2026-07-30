const db = require('../../config/db');
const redis = require('../../config/redis');
const bcrypt = require('bcrypt');
const auditService = require('../audit/audit.service');

class StaffService {
  async generateUniqueStaffCode(name) {
    const words = name.trim().split(/\s+/);
    let prefix = '';
    if (words.length >= 2) {
      prefix = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      prefix = words[0].substring(0, 2).toUpperCase();
      if (prefix.length === 1) prefix += 'X';
    } else {
      prefix = 'XX';
    }

    let isUnique = false;
    let code = '';
    while (!isUnique) {
      const randomDigits = Math.floor(10 + Math.random() * 90).toString(); // 10-99
      code = prefix + randomDigits;
      const [rows] = await db.query('SELECT id FROM staff WHERE staff_code = ? LIMIT 1', [code]);
      if (rows.length === 0) {
        isUnique = true;
      }
    }
    return code;
  }

  async createStaff(payload, creatorId) {
    const { name, email, password, role } = payload;
    let { staff_code } = payload;
    
    if (!staff_code) {
      staff_code = await this.generateUniqueStaffCode(name);
    }
    
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const [result] = await db.query(
        'INSERT INTO staff (name, email, password_hash, role, staff_code, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, passwordHash, role || 'staff', staff_code, creatorId]
      );
      
      const newStaffId = result.insertId;
      await auditService.log({
        actorId: creatorId,
        actorRole: 'admin',
        action: 'STAFF_CREATE',
        entityType: 'staff',
        entityId: newStaffId,
        meta: { email, role, staff_code }
      });

      return { id: newStaffId, name, email, role, staff_code };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const e = new Error('Email or Staff Code already exists');
        e.statusCode = 409;
        throw e;
      }
      throw err;
    }
  }

  async getStaffList(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [rows] = await db.query('SELECT id, name, email, role, staff_code, is_disabled, created_at FROM staff ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM staff');
    
    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  async getStaffById(id) {
    const [rows] = await db.query('SELECT id, name, email, role, staff_code, is_disabled, created_at FROM staff WHERE id = ?', [id]);
    if (rows.length === 0) {
      const e = new Error('Staff not found');
      e.statusCode = 404;
      throw e;
    }
    return rows[0];
  }

  async updateStaff(id, payload, updaterId) {
    const { name, email, role, isDisabled, password, staff_code } = payload;
    
    let query = 'UPDATE staff SET updated_at = NOW()';
    const params = [];

    if (name) { query += ', name = ?'; params.push(name); }
    if (email) { query += ', email = ?'; params.push(email); }
    if (role) { query += ', role = ?'; params.push(role); }
    if (staff_code !== undefined) { query += ', staff_code = ?'; params.push(staff_code); }
    if (isDisabled !== undefined) { query += ', is_disabled = ?'; params.push(isDisabled ? 1 : 0); }
    if (password) { 
      query += ', password_hash = ?'; 
      params.push(await bcrypt.hash(password, 10)); 
    }

    query += ' WHERE id = ?';
    params.push(id);

    if (params.length > 1) { // more than just id
      await db.query(query, params);
      
      await auditService.log({
        actorId: updaterId,
        actorRole: 'admin',
        action: 'STAFF_UPDATE',
        entityType: 'staff',
        entityId: id,
        meta: payload
      });

      if (isDisabled) {
        // Kill all Redis sessions for this user
        const sessionKeys = await redis.keys(`session:${id}:*`);
        if (sessionKeys.length > 0) {
          await redis.del(...sessionKeys);
        }
      }
    }

    return this.getStaffById(id);
  }

  async deleteStaff(id, deleterId) {
    // Soft delete via is_disabled to preserve audit references
    await this.updateStaff(id, { isDisabled: true }, deleterId);
    await auditService.log({
        actorId: deleterId,
        actorRole: 'admin',
        action: 'STAFF_DELETE',
        entityType: 'staff',
        entityId: id
    });
  }
}

module.exports = new StaffService();
