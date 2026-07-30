const db = require('../../config/db');
const bcrypt = require('bcryptjs');
const ApiResponse = require('../../utils/apiResponse');
const auditService = require('../audit/audit.service');

class WipeController {
  
  async verifyPortalPassword(password) {
    if (!password) return false;
    const [rows] = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = "wipe_portal_password"');
    if (rows.length === 0) return false;
    
    const hash = rows[0].setting_value;
    return await bcrypt.compare(password, hash);
  }

  wipeUsers = async (req, res) => {
    const { portalPassword } = req.body;
    
    const isValid = await this.verifyPortalPassword(portalPassword);
    if (!isValid) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Invalid portal password'));
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // TRUNCATE is faster and resets auto-increment
      // Note: Foreign keys might block TRUNCATE, so we temporarily disable checks
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      
      await connection.query('TRUNCATE TABLE users');
      await connection.query('TRUNCATE TABLE archived_users');
      await connection.query('TRUNCATE TABLE user_queries');
      await connection.query('TRUNCATE TABLE deletion_requests');
      await connection.query('TRUNCATE TABLE import_batches');
      
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');

      await connection.commit();

      await auditService.log({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'WIPE_ALL_USERS',
        entityType: 'database',
        meta: { ip: req.ip }
      });

      return res.status(200).json(ApiResponse.success({}, 'All users and related data have been wiped successfully'));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  verifyPassword = async (req, res) => {
    const { portalPassword } = req.body;
    const isValid = await this.verifyPortalPassword(portalPassword);
    
    if (!isValid) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Invalid portal password'));
    }
    
    return res.status(200).json(ApiResponse.success({}, 'Password verified'));
  };

  changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'New password must be at least 6 characters'));
    }

    const isValid = await this.verifyPortalPassword(currentPassword);
    if (!isValid) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Invalid current portal password'));
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    
    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value, updated_by) 
      VALUES ('wipe_portal_password', ?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)
    `, [hash, req.user.id]);

    await auditService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'UPDATE_PORTAL_PASSWORD',
      entityType: 'system_settings',
      meta: { ip: req.ip }
    });

    return res.status(200).json(ApiResponse.success({}, 'Portal password updated successfully'));
  };

  wipeStaff = async (req, res) => {
    const { portalPassword } = req.body;
    
    const isValid = await this.verifyPortalPassword(portalPassword);
    if (!isValid) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Invalid portal password'));
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // We cannot TRUNCATE because we want to preserve the currently logged in admin.
      // So we use DELETE.
      // We first NULL out created_by for the current admin if it references a staff we are deleting
      await connection.query('UPDATE staff SET created_by = NULL WHERE id = ?', [req.user.id]);
      
      // Also to prevent FK constraint failures on audit_logs, we could just delete them or set to NULL.
      // Assuming audit logs actor_id doesn't have a strict FK constraint (it usually doesn't, or we set SET FOREIGN_KEY_CHECKS = 0).
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      
      const [result] = await connection.query('DELETE FROM staff WHERE id != ?', [req.user.id]);
      
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      await connection.commit();

      await auditService.log({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'WIPE_ALL_STAFF',
        entityType: 'database',
        meta: { deletedCount: result.affectedRows, ip: req.ip }
      });

      return res.status(200).json(ApiResponse.success({ deletedCount: result.affectedRows }, 'All other staff members have been deleted successfully'));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}

module.exports = new WipeController();
