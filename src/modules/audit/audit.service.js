const db = require('../../config/db');

class AuditService {
  /**
   * Logs an audit event to the database.
   * @param {Object} params
   * @param {number|null} params.actorId - ID of the staff/admin. Null if system/public.
   * @param {string} params.actorRole - 'admin', 'staff', 'public', or 'system'
   * @param {string} params.action - Action name (e.g. 'USER_CREATE', 'SETTINGS_TOGGLE')
   * @param {string} [params.entityType] - Type of entity affected (e.g. 'user', 'settings')
   * @param {string|number} [params.entityId] - ID of the entity affected
   * @param {Object} [params.meta] - Additional JSON metadata
   * @param {string} [params.ipAddress] - Request IP address
   */
  async log({ actorId = null, actorRole, action, entityType = null, entityId = null, meta = null, ipAddress = null }) {
    try {
      await db.query(
        `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, meta, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [actorId, actorRole, action, entityType, entityId, meta ? JSON.stringify(meta) : null, ipAddress]
      );
    } catch (error) {
      // We don't want audit log failures to crash the main transaction, but we should log them.
      console.error('Audit log failed:', error);
    }
  }
}

module.exports = new AuditService();
