-- =========================================================
-- SQL Migration Script for MSG91 Email & Webhook Integration
-- Database: vishalji_crm
-- Description: Creates msg91_email_webhook_events audit table,
--              adds correlation (crqid) & event tracking columns,
--              modifies status columns, and initializes system settings.
-- =========================================================

USE vishalji_crm;

-- 1. Create MSG91 Webhook Events Audit & Idempotency Table
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

-- 2. Modify Status Columns to VARCHAR(50) to Support All Webhook Statuses
ALTER TABLE email_logs MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'sent';
ALTER TABLE campaign_recipients MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';
ALTER TABLE email_events MODIFY COLUMN event_type VARCHAR(50) NOT NULL;

-- 3. Add Correlation (crqid) & Lifecycle Timestamp Columns to email_logs
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS crqid VARCHAR(100) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS msg_id VARCHAR(100) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(100) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS failed_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS opened_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS clicked_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS unsubscribed_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS complained_at DATETIME NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS failure_category VARCHAR(100) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS status_code VARCHAR(50) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS enhanced_status_code VARCHAR(50) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS last_event VARCHAR(50) NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS last_event_at DATETIME NULL;

-- 4. Add Correlation (crqid) & Lifecycle Timestamp Columns to campaign_recipients
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS crqid VARCHAR(100) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS msg_id VARCHAR(100) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS request_id VARCHAR(100) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failed_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS opened_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS clicked_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS unsubscribed_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS complained_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failure_category VARCHAR(100) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS status_code VARCHAR(50) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS enhanced_status_code VARCHAR(50) NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS open_count INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS click_count INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS last_opened_at DATETIME NULL;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS last_clicked_at DATETIME NULL;

-- 5. Create Correlation & Lookup Indexes
CREATE INDEX idx_email_logs_crqid ON email_logs (crqid);
CREATE INDEX idx_email_logs_msg_id ON email_logs (msg_id);
CREATE INDEX idx_camp_rec_crqid ON campaign_recipients (crqid);
CREATE INDEX idx_camp_rec_msg_id ON campaign_recipients (msg_id);

-- 6. Insert Default MSG91 & Webhook Configuration Keys into system_settings
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES 
  ('msg91_auth_key', ''),
  ('msg91_domain', ''),
  ('msg91_from_email', ''),
  ('msg91_from_name', 'RESOL CRM'),
  ('msg91_default_template_id', ''),
  ('msg91_webhook_secret', ''),
  ('email_provider', 'nodemailer');
