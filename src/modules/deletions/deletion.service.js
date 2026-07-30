const db = require('../../config/db');
const auditService = require('../audit/audit.service');

class DeletionService {
  async getDeletionRequests() {
    const [rows] = await db.query(
      'SELECT id, name, email, mobile, city, deletion_reason, updated_at FROM users WHERE is_deletion_requested = 1'
    );
    return rows;
  }

  async approveDeletion(userId, adminId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch User
      const [users] = await connection.query('SELECT * FROM users WHERE id = ? AND is_deletion_requested = 1', [userId]);
      if (users.length === 0) {
        const e = new Error('Deletion request not found');
        e.statusCode = 404;
        throw e;
      }
      const user = users[0];

      // 2. Insert into archived_users
      await connection.query(
        `INSERT INTO archived_users (
          id, name, designation, department, institute, city, state, region_type,
          email, mobile, source, original_created_by, original_created_at, deleted_by, deletion_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.name, user.designation, user.department, user.institute, user.city, user.state, user.region_type,
          user.email, user.mobile, user.source, user.created_by, user.created_at, adminId, user.deletion_reason
        ]
      );

      // 3. Delete from users
      await connection.query('DELETE FROM users WHERE id = ?', [userId]);

      // 4. Audit Log
      await auditService.log({
        actorId: adminId,
        actorRole: 'admin',
        action: 'USER_DELETION_APPROVED',
        entityType: 'user',
        entityId: userId,
        meta: { reason: user.deletion_reason }
      });

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async rejectDeletion(userId, adminId) {
    const [result] = await db.query(
      'UPDATE users SET is_deletion_requested = 0, deletion_reason = NULL WHERE id = ? AND is_deletion_requested = 1',
      [userId]
    );

    if (result.affectedRows === 0) {
      const e = new Error('Deletion request not found');
      e.statusCode = 404;
      throw e;
    }

    await auditService.log({
      actorId: adminId,
      actorRole: 'admin',
      action: 'USER_DELETION_REJECTED',
      entityType: 'user',
      entityId: userId
    });
  }
}

module.exports = new DeletionService();
