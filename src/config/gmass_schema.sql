-- Add lead campaign tracking columns to existing users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS lead_status VARCHAR(50) NULL DEFAULT 'New',
  ADD COLUMN IF NOT EXISTS is_opted_out TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_invalid TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_automated_followups TINYINT(1) NOT NULL DEFAULT 0;

-- Email campaigns table
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
);

-- Campaign recipients table
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
);

-- Email events log (idempotent event tracking)
CREATE TABLE IF NOT EXISTS email_events (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id         BIGINT UNSIGNED NULL,
  contact_id          BIGINT UNSIGNED NULL,
  recipient_email     VARCHAR(200) NOT NULL,
  event_type          ENUM('Send', 'Open', 'Click', 'Reply', 'Unsubscribe', 'Bounce') NOT NULL,
  event_source        VARCHAR(50) NOT NULL DEFAULT 'webhook',
  raw_payload         JSON NULL,
  event_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_contact_event (campaign_id, recipient_email, event_type, event_at),
  INDEX idx_event_campaign (campaign_id),
  INDEX idx_event_contact (contact_id),
  INDEX idx_event_type (event_type)
);

-- Seed GMass System Settings
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES 
  ('gmass_api_key', '4e004d3a-1cb8-4b24-9cce-4c751fa6e8ec'),
  ('gmass_webhook_secret', 'gmass_crm_secret__2026'),
  ('gmass_webhook_enabled', 'true'),
  ('gmass_polling_enabled', 'true')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
