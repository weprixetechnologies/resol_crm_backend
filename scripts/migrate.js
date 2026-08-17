const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Running migrations...');
    const safeAddColumn = async (query) => {
      try {
        await db.query(query);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`Column already exists: ${query}`);
        } else {
          throw err;
        }
      }
    };

    await safeAddColumn(`ALTER TABLE users ADD COLUMN is_admin_verified TINYINT(1) NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN is_deletion_requested TINYINT(1) NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN deletion_reason VARCHAR(255) NULL;`);

    // New fields: status, tag1, tag2
    await safeAddColumn(`ALTER TABLE users ADD COLUMN status ENUM('active','unverified') NOT NULL DEFAULT 'active';`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN tag1 VARCHAR(255) NULL;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN tag2 VARCHAR(255) NULL;`);

    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN status ENUM('active','unverified') NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN tag1 VARCHAR(255) NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN tag2 VARCHAR(255) NULL;`);

    // Mailing system tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(200) NOT NULL,
        subject       VARCHAR(255) NOT NULL,
        body_html     LONGTEXT NOT NULL,
        design_json   JSON NULL,
        created_by    INT UNSIGNED NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_template_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipient_email VARCHAR(200) NOT NULL,
        recipient_name  VARCHAR(150) NULL,
        user_id         BIGINT UNSIGNED NULL,
        template_id     INT UNSIGNED NULL,
        subject         VARCHAR(255) NOT NULL,
        status          ENUM('sent','failed') NOT NULL DEFAULT 'sent',
        error_message   TEXT NULL,
        sent_by         INT UNSIGNED NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_logs_status (status),
        INDEX idx_email_logs_user (user_id),
        INDEX idx_email_logs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.query(`
      INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES 
        ('smtp_host', ''),
        ('smtp_port', '587'),
        ('smtp_secure', 'false'),
        ('smtp_user', ''),
        ('smtp_pass', ''),
        ('smtp_from_email', ''),
        ('smtp_from_name', '');
    `);

    console.log('Migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
