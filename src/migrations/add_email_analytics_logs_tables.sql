-- Migration script for Email Analytics, Webhooks, Events & Internal Email Logs
USE vishalji_crm;

-- 1. Create email_events Table for Per-Email Journey Timeline Tracking
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

-- 2. Create MSG91 Webhook Events Audit Table
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

-- 3. Update Columns on email_logs
ALTER TABLE email_logs MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'QUEUED';

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS crqid VARCHAR(100) NULL AFTER subject,
  ADD COLUMN IF NOT EXISTS msg_id VARCHAR(100) NULL AFTER crqid,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(100) NULL AFTER msg_id,
  ADD COLUMN IF NOT EXISTS msg91_uuid VARCHAR(100) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS msg91_template_id VARCHAR(100) NULL AFTER template_id,
  ADD COLUMN IF NOT EXISTS msg91_version_id VARCHAR(100) NULL AFTER msg91_template_id,
  ADD COLUMN IF NOT EXISTS campaign_id INT UNSIGNED NULL AFTER msg91_version_id,
  ADD COLUMN IF NOT EXISTS variables JSON NULL AFTER campaign_id,
  ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS failed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS opened_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS first_opened_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_opened_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS open_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS first_clicked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_clicked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS click_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS complained_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS failure_category VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS status_code VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS enhanced_status_code VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS last_event VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS last_event_at DATETIME NULL;
