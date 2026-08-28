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

    // Country & Region field migrations
    await safeAddColumn(`ALTER TABLE users MODIFY COLUMN region_type VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN country VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users MODIFY COLUMN region_type VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN country VARCHAR(100) NULL;`);

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

    // Modify status columns to VARCHAR(50) to support all webhook events (queued, accepted, delivered, opened, clicked, unsubscribed, complaint, failed)
    await safeAddColumn(`ALTER TABLE email_logs MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'sent';`);
    await safeAddColumn(`ALTER TABLE campaign_recipients MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';`);
    await safeAddColumn(`ALTER TABLE email_events MODIFY COLUMN event_type VARCHAR(50) NOT NULL;`);

    // Add tracking columns to email_logs
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN crqid VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN msg_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN request_id VARCHAR(100) NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN delivered_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN failed_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN opened_at DATETIME NULL;`);
    await safeAddColumn(`ALTER TABLE email_logs ADD COLUMN clicked_at DATETIME NULL;`);
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
