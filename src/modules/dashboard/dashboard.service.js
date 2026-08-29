const db = require('../../config/db');
const redis = require('../../config/redis');

class DashboardService {
  async getStats(user, range = '7d', contactOptions = {}) {
    let dbStatus = 'Connected';
    let redisStatus = 'Connected';

    try {
      await db.query('SELECT 1');
    } catch(e) {
      dbStatus = 'Disconnected';
    }

    try {
      await redis.ping();
    } catch(e) {
      redisStatus = 'Disconnected';
    }

    const systemHealth = {
      database: dbStatus,
      redis: redisStatus,
      api: 'Connected' // If they can hit this endpoint, API is connected
    };

    // Calculate Contacts Created Stats based on dynamic value and unit (hours/days) and staff code filter
    const unit = contactOptions.contactUnit === 'days' ? 'days' : 'hours';
    const rawVal = parseInt(contactOptions.contactValue);
    const value = Math.max(1, Math.min(365 * 24, isNaN(rawVal) ? (unit === 'days' ? 7 : 24) : rawVal));
    const staffCodeFilter = (contactOptions.staffCode || '').trim();

    let contactDateSelect, contactGroupClause, contactIntervalClause;
    if (unit === 'days') {
      contactDateSelect = "DATE_FORMAT(u.created_at, '%Y-%m-%d') as date";
      contactGroupClause = "DATE_FORMAT(u.created_at, '%Y-%m-%d')";
      contactIntervalClause = `INTERVAL ${value} DAY`;
    } else {
      contactIntervalClause = `INTERVAL ${value} HOUR`;
      if (value > 48) {
        contactDateSelect = "DATE_FORMAT(u.created_at, '%Y-%m-%d') as date";
        contactGroupClause = "DATE_FORMAT(u.created_at, '%Y-%m-%d')";
      } else {
        contactDateSelect = "DATE_FORMAT(u.created_at, '%Y-%m-%d %H:00:00') as date";
        contactGroupClause = "DATE_FORMAT(u.created_at, '%Y-%m-%d %H:00:00')";
      }
    }

    let contactWhere = `u.created_at >= NOW() - ${contactIntervalClause}`;
    const contactParams = [];

    if (staffCodeFilter) {
      contactWhere += ` AND s.staff_code LIKE ?`;
      contactParams.push(`%${staffCodeFilter}%`);
    }

    if (user.role !== 'admin') {
      const settingsStr = await redis.get('system_settings');
      let staffScope = 'all';
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        staffScope = settings.staff_scope || 'all';
      }
      if (staffScope === 'self_only') {
        contactWhere += ` AND u.created_by = ?`;
        contactParams.push(user.id);
      }
    }

    const [[{ contactsCount }]] = await db.query(
      `SELECT COUNT(*) as contactsCount FROM users u LEFT JOIN staff s ON u.created_by = s.id WHERE ${contactWhere}`,
      contactParams
    );

    const [contactChartRows] = await db.query(
      `SELECT ${contactDateSelect}, COUNT(*) as count 
       FROM users u 
       LEFT JOIN staff s ON u.created_by = s.id 
       WHERE ${contactWhere} 
       GROUP BY ${contactGroupClause} 
       ORDER BY ${contactGroupClause} ASC`,
      contactParams
    );

    // Get active staff list for frontend filter dropdown
    const [staffList] = await db.query(
      'SELECT id, name, staff_code FROM staff WHERE is_disabled = 0 AND staff_code IS NOT NULL AND staff_code != "" ORDER BY staff_code ASC'
    );

    const contactsCreatedStats = {
      total: contactsCount || 0,
      value,
      unit,
      staffCode: staffCodeFilter,
      staffList: staffList || [],
      chartData: contactChartRows || []
    };

    if (user.role === 'admin') {
      const [[{ totalStaff }]] = await db.query('SELECT COUNT(*) as totalStaff FROM staff WHERE is_disabled = 0');
      const [[{ totalUsers }]] = await db.query('SELECT COUNT(*) as totalUsers FROM users');
      const [[{ pendingDeletions }]] = await db.query('SELECT COUNT(*) as pendingDeletions FROM users WHERE is_deletion_requested = 1');
      const [[{ archivedUsers }]] = await db.query('SELECT COUNT(*) as archivedUsers FROM archived_users');
      
      let dateSelect, groupClause, intervalClause;

      if (range === '1h') {
        dateSelect = "DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:00') as date";
        groupClause = "DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:00')";
        intervalClause = "INTERVAL 1 HOUR";
      } else if (range === '6h') {
        dateSelect = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as date";
        groupClause = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')";
        intervalClause = "INTERVAL 6 HOUR";
      } else if (range === '12h') {
        dateSelect = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as date";
        groupClause = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')";
        intervalClause = "INTERVAL 12 HOUR";
      } else if (range === '24h') {
        dateSelect = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as date";
        groupClause = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')";
        intervalClause = "INTERVAL 24 HOUR";
      } else { // '7d' default
        dateSelect = "DATE(created_at) as date";
        groupClause = "DATE(created_at)";
        intervalClause = "INTERVAL 6 DAY"; 
      }

      const [chartDataRows] = await db.query(`
        SELECT ${dateSelect}, COUNT(*) as count 
        FROM audit_logs 
        WHERE created_at >= NOW() - ${intervalClause} 
        GROUP BY ${groupClause} 
        ORDER BY ${groupClause} ASC
      `);

      // Recent 10 audit logs for dashboard feed
      const [recentLogs] = await db.query(`
        SELECT id, actor_id, actor_role, action, entity_type, entity_id, created_at 
        FROM audit_logs 
        ORDER BY created_at DESC 
        LIMIT 10
      `);

      return {
        totalStaff,
        totalUsers,
        pendingDeletions,
        archivedUsers,
        contactsCreatedStats,
        chartData: chartDataRows,
        recentLogs,
        systemHealth
      };
    } else {
      // Staff Stats
      const [[{ totalUsers }]] = await db.query('SELECT COUNT(*) as totalUsers FROM users');
      const [[{ myTotalUsers }]] = await db.query('SELECT COUNT(*) as myTotalUsers FROM users WHERE created_by = ?', [user.id]);
      const [[{ myTodayUsers }]] = await db.query('SELECT COUNT(*) as myTodayUsers FROM users WHERE created_by = ? AND DATE(created_at) = CURDATE()', [user.id]);

      // Chart data: Users created by this staff per day over last 7 days
      const [chartDataRows] = await db.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count 
        FROM users 
        WHERE created_by = ? AND created_at >= DATE(NOW()) - INTERVAL 6 DAY 
        GROUP BY DATE(created_at) 
        ORDER BY DATE(created_at) ASC
      `, [user.id]);

      return {
        totalUsers,
        myTotalUsers,
        myTodayUsers,
        contactsCreatedStats,
        chartData: chartDataRows,
        recentLogs: [], // Staff don't see audit logs
        systemHealth
      };
    }
  }

  async getAuditLogs(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      'SELECT id, actor_id, actor_role, action, entity_type, entity_id, meta, ip_address, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM audit_logs');

    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = new DashboardService();
