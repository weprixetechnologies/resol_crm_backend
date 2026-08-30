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

    // Serial Number (sl_no) field migrations
    await safeAddColumn(`ALTER TABLE users ADD COLUMN sl_no BIGINT UNSIGNED NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN sl_no BIGINT UNSIGNED NULL;`);

    // Backfill / Resync serial numbers for existing users
    console.log('Syncing serial numbers (sl_no) for users table...');
    await db.query(`SET @seq = 0;`);
    await db.query(`UPDATE users SET sl_no = (@seq := @seq + 1) ORDER BY created_at ASC, id ASC;`);

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
        ('smtp_from_name', ''),
        ('msg91_auth_key', ''),
        ('msg91_domain', ''),
        ('msg91_from_email', ''),
        ('msg91_from_name', 'RESOL CRM'),
        ('msg91_default_template_id', ''),
        ('msg91_webhook_secret', '');
    `);

    // MSG91 Webhook Events Audit Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS msg91_email_webhook_events (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        idempotency_key     VARCHAR(255) NOT NULL UNIQUE,
        request_id          VARCHAR(100) NULL,
        uuid                VARCHAR(100) NULL,
        crqid               VARCHAR(100) NULL,
        recipient           VARCHAR(200) NULL,
        sender              VARCHAR(200) NULL,
        event_id            VARCHAR(100) NULL,
        event_name          VARCHAR(100) NULL,
        normalized_event    VARCHAR(50) NULL,
        msg_id              VARCHAR(100) NULL,
        campaign_request_id VARCHAR(100) NULL,
        campaign_name       VARCHAR(200) NULL,
        template_name       VARCHAR(200) NULL,
        subject             VARCHAR(255) NULL,
        status_code         VARCHAR(50) NULL,
        enhanced_status_code VARCHAR(50) NULL,
        reason              TEXT NULL,
        failure_category    VARCHAR(100) NULL,
        requested_at        DATETIME NULL,
        status_updated_at   DATETIME NULL,
        received_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        raw_payload         JSON NULL,
        processing_status   ENUM('PROCESSED', 'DUPLICATE', 'UNMATCHED', 'UNKNOWN_EVENT', 'FAILED') NOT NULL DEFAULT 'PROCESSED',
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_msg91_req_id (request_id),
        INDEX idx_msg91_crqid (crqid),
        INDEX idx_msg91_msg_id (msg_id),
        INDEX idx_msg91_recipient (recipient),
        INDEX idx_msg91_event_name (event_name),
        INDEX idx_msg91_proc_status (processing_status),
        INDEX idx_msg91_received_at (received_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Email Events Timeline Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email_log_id        BIGINT UNSIGNED NULL,
        provider            VARCHAR(50) NOT NULL DEFAULT 'MSG91',
        provider_event_id   VARCHAR(100) NULL,
        event_name          VARCHAR(100) NOT NULL,
        event_status        VARCHAR(50) NULL,
        event_timestamp     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        recipient           VARCHAR(200) NULL,
        msg91_request_id    VARCHAR(100) NULL,
        msg91_uuid          VARCHAR(100) NULL,
        crqid               VARCHAR(100) NULL,
        raw_payload         JSON NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_events_log (email_log_id),
        INDEX idx_email_events_crqid (crqid),
        INDEX idx_email_events_name (event_name),
        INDEX idx_email_events_time (event_timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Modify status columns to VARCHAR(50) to support all webhook events (queued, accepted, delivered, opened, clicked, unsubscribed, complaint, failed)
    await safeAddColumn(`ALTER TABLE email_logs MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'QUEUED';`);
    await safeAddColumn(`ALTER TABLE campaign_recipients MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';`);
    await safeAddColumn(`ALTER TABLE email_events MODIFY COLUMN event_name VARCHAR(100) NOT NULL;`);

    // Add MSG91 Template integration columns to email_templates
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN msg91_template_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN msg91_slug VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN slug VARCHAR(200) NULL;`);
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN variables JSON NULL;`);
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'PENDING';`);
    await safeAddColumn(`ALTER TABLE email_templates ADD COLUMN is_uploaded TINYINT(1) NOT NULL DEFAULT 0;`);

    // Dedicated integration mapping table for CRM <-> MSG91
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_template_integrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        crm_template_id INT UNSIGNED NOT NULL,
        provider VARCHAR(50) NOT NULL DEFAULT 'MSG91',
        msg91_template_id VARCHAR(100) NOT NULL,
        msg91_version_id VARCHAR(100) NULL,
        msg91_status_id INT NULL,
        provider_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        last_synced_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_provider_msg91_template (provider, msg91_template_id),
        UNIQUE KEY uq_crm_template_provider (crm_template_id, provider),
        INDEX idx_crm_template_id (crm_template_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Add tracking columns to email_logs
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN crqid VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN msg_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN request_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN msg91_uuid VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN msg91_template_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN msg91_version_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN campaign_id INT UNSIGNED NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN variables JSON NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN delivered_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN failed_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN first_opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN last_opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN open_count INT UNSIGNED NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN clicked_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN first_clicked_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN last_clicked_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN click_count INT UNSIGNED NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN unsubscribed_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN complained_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN failure_reason TEXT NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN failure_category VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN status_code VARCHAR(50) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN enhanced_status_code VARCHAR(50) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN last_event VARCHAR(50) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN last_event_at DATETIME NULL;`);

    // Add tracking columns to campaign_recipients
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN crqid VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN msg_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN request_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN delivered_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN failed_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN clicked_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN unsubscribed_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN complained_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN failure_reason TEXT NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN failure_category VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN status_code VARCHAR(50) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN enhanced_status_code VARCHAR(50) NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN open_count INT UNSIGNED NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN click_count INT UNSIGNED NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN last_opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE campaign_recipients ADD COLUMN last_clicked_at DATETIME NULL;`);

    const safeAddIndex = async (query) => {
      try {
        await db.query(query);
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME') {
          console.log(`Index already exists: ${query}`);
        } else {
          throw err;
        }
      }
    };

    await safeAddIndex(`CREATE INDEX idx_email_logs_crqid ON email_logs (crqid);`);
    await safeAddIndex(`CREATE INDEX idx_email_logs_msg_id ON email_logs (msg_id);`);
    await safeAddIndex(`CREATE INDEX idx_camp_rec_crqid ON campaign_recipients (crqid);`);
    await safeAddIndex(`CREATE INDEX idx_camp_rec_msg_id ON campaign_recipients (msg_id);`);

    console.log('Migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
