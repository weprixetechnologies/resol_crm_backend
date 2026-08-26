const db = require('../src/config/db');

async function runMigrations() {
  console.log('Running GMass DB migrations...');
  try {
    // 1. Add columns to users table if they don't exist
    const columns = [
      { name: 'lead_status', type: "VARCHAR(50) NULL DEFAULT 'New'" },
      { name: 'is_opted_out', type: 'TINYINT(1) NOT NULL DEFAULT 0' },
      { name: 'email_invalid', type: 'TINYINT(1) NOT NULL DEFAULT 0' },
      { name: 'stop_automated_followups', type: 'TINYINT(1) NOT NULL DEFAULT 0' }
    ];

    for (const col of columns) {
      try {
        await db.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Added column ${col.name} to users table.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`Column ${col.name} already exists on users table.`);
        } else {
          console.warn(`Warning adding column ${col.name}:`, err.message);
        }
      }
    }

    // 2. Create email_campaigns table
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name                VARCHAR(200) NOT NULL,
        subject             VARCHAR(255) NOT NULL,
        template_id         INT UNSIGNED NULL,
        gmass_campaign_id   VARCHAR(100) NULL,
        gmass_draft_id      VARCHAR(100) NULL,
        status              ENUM('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'draft',
        scheduled_at        DATETIME NULL,
        send_config         JSON NULL,
        created_by          INT UNSIGNED NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_gmass_campaign_id (gmass_campaign_id),
        INDEX idx_campaign_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table email_campaigns ready.');

    // 3. Create campaign_recipients table
    await db.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        campaign_id         BIGINT UNSIGNED NOT NULL,
        contact_id          BIGINT UNSIGNED NULL,
        email_address       VARCHAR(200) NOT NULL,
        gmass_recipient_ref VARCHAR(100) NULL,
        status              ENUM('pending', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'failed') NOT NULL DEFAULT 'pending',
        sent_at             DATETIME NULL,
        opened_at           DATETIME NULL,
        clicked_at          DATETIME NULL,
        replied_at          DATETIME NULL,
        bounced_at          DATETIME NULL,
        unsubscribed_at     DATETIME NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
        INDEX idx_recip_campaign (campaign_id),
        INDEX idx_recip_contact (contact_id),
        INDEX idx_recip_email (email_address),
        INDEX idx_recip_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table campaign_recipients ready.');

    // 4. Create email_events table
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        campaign_id         BIGINT UNSIGNED NULL,
        contact_id          BIGINT UNSIGNED NULL,
        recipient_email     VARCHAR(200) NOT NULL,
        event_type          ENUM('Send', 'Open', 'Click', 'Reply', 'Unsubscribe', 'Bounce') NOT NULL,
        event_source        ENUM('webhook', 'poll') NOT NULL DEFAULT 'webhook',
        raw_payload         JSON NULL,
        event_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_campaign_contact_event (campaign_id, recipient_email, event_type, event_at),
        INDEX idx_event_campaign (campaign_id),
        INDEX idx_event_contact (contact_id),
        INDEX idx_event_type (event_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table email_events ready.');

    console.log('GMass migrations finished successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

runMigrations();
