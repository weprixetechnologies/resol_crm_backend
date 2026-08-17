const db = require('../../config/db');
const redis = require('../../config/redis');
const auditService = require('../audit/audit.service');

class SettingsService {
  async getSettings() {
    // 1. Try Redis
    const cached = await redis.get('system_settings');
    if (cached) return JSON.parse(cached);

    // 2. Fallback to DB
    const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    for (const row of rows) {
      if (row.setting_value === 'true') settings[row.setting_key] = true;
      else if (row.setting_value === 'false') settings[row.setting_key] = false;
      else settings[row.setting_key] = row.setting_value;
    }

    if (Object.keys(settings).length > 0) {
      await this.cacheSettings(settings);
    }
    return settings;
  }

  async updateSettings(payload, adminId) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const updates = {};
      for (const [key, val] of Object.entries(payload)) {
        let stringVal = val;
        if (typeof val === 'boolean') {
          stringVal = val ? 'true' : 'false';
        } else if (val === null || val === undefined) {
          stringVal = '';
        } else {
          stringVal = String(val);
        }

        await connection.query(
          `INSERT INTO system_settings (setting_key, setting_value, updated_by)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
          [key, stringVal, adminId]
        );
        updates[key] = stringVal;
      }

      await connection.commit();

      if (Object.keys(updates).length > 0) {
        // Fetch all current settings and rebuild cache
        const [rows] = await connection.query('SELECT setting_key, setting_value FROM system_settings');
        const settings = {};
        for (const row of rows) {
          if (row.setting_value === 'true') settings[row.setting_key] = true;
          else if (row.setting_value === 'false') settings[row.setting_key] = false;
          else settings[row.setting_key] = row.setting_value;
        }
        await this.cacheSettings(settings);

        await auditService.log({
          actorId: adminId,
          actorRole: 'admin',
          action: 'SETTINGS_UPDATE',
          entityType: 'settings',
          meta: updates
        });
        return settings;
      }
      
      return this.getSettings();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async cacheSettings(settingsObj) {
    await redis.set('system_settings', JSON.stringify(settingsObj));
  }
}

module.exports = new SettingsService();
