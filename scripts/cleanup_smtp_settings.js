const db = require('../src/config/db');
const redis = require('../src/config/redis');

async function cleanupSmtpSettings() {
  console.log('=== Cleaning up old SMTP settings & ithyaraa references from DB & Redis ===');
  try {
    const smtpKeys = [
      'smtp_host',
      'smtp_port',
      'smtp_secure',
      'smtp_user',
      'smtp_pass',
      'smtp_from_email',
      'smtp_from_name'
    ];

    const [result] = await db.query(
      'DELETE FROM system_settings WHERE setting_key IN (?) OR setting_value LIKE ?',
      [smtpKeys, '%ithyaraa%']
    );

    console.log(`✓ Deleted ${result.affectedRows} SMTP/ithyaraa setting row(s) from MySQL system_settings table.`);

    await redis.del('system_settings');
    console.log('✓ Purged Redis system_settings cache.');

    console.log('=== Cleanup complete successfully ===');
  } catch (err) {
    console.error('❌ Error during cleanup:', err.message);
  } finally {
    process.exit(0);
  }
}

cleanupSmtpSettings();
