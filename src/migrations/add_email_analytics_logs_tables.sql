-- ====================================================================
-- Complete SQL Migration Script for Email System, Analytics & MSG91 Integration
-- Database: resol_crm / vishalji_crm
-- ====================================================================

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

-- 2. Ensure missing columns are added if email_events table already existed
ALTER TABLE email_events
  ADD COLUMN IF NOT EXISTS email_log_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'MSG91',
  ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS event_name VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS event_status VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS event_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recipient VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS msg91_request_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_uuid VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS crqid VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS raw_payload JSON NULL;

-- 3. Create MSG91 Webhook Events Audit Table
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

-- 4. Create Dedicated Integration Mapping Table for CRM <-> MSG91
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

-- 5. Update email_templates Table Columns
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS slug VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS variables JSON NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS is_uploaded TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS msg91_template_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_slug VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_version_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_status VARCHAR(50) DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS msg91_status_id INT NULL;

-- 6. Update email_logs Table Columns & Status Type
ALTER TABLE email_logs MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'QUEUED';

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS crqid VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_uuid VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_template_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS msg91_version_id VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS campaign_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS variables JSON NULL,
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
  ADD COLUMN IF NOT EXISTS last_event_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS bounce_type VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS is_hard_bounce TINYINT(1) NOT NULL DEFAULT 0;

-- 7. Create Permanent Internal CRM Email Bounces & Suppression Table (PART 9)
CREATE TABLE IF NOT EXISTS email_bounces (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email_log_id        BIGINT UNSIGNED NULL,
  recipient_email     VARCHAR(200) NOT NULL UNIQUE,
  recipient_name      VARCHAR(200) NULL,
  crm_contact_id      INT UNSIGNED NULL,
  crm_template_id     INT UNSIGNED NULL,
  msg91_template_id   VARCHAR(100) NULL,
  msg91_version_id    VARCHAR(100) NULL,
  campaign_id         INT UNSIGNED NULL,
  crqid               VARCHAR(100) NULL,
  msg91_request_id    VARCHAR(100) NULL,
  msg91_uuid          VARCHAR(100) NULL,
  bounce_type         ENUM('HARD_BOUNCE', 'SOFT_BOUNCE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  provider_status     VARCHAR(50) NOT NULL DEFAULT 'FAILED',
  event_name          VARCHAR(100) NULL,
  status_code         VARCHAR(50) NULL,
  enhanced_status_code VARCHAR(50) NULL,
  reason              TEXT NULL,
  first_bounced_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_bounced_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  bounce_count        INT UNSIGNED NOT NULL DEFAULT 1,
  is_hard_bounce      TINYINT(1) NOT NULL DEFAULT 0,
  is_soft_bounce      TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bounces_email (recipient_email),
  INDEX idx_bounces_type (bounce_type),
  INDEX idx_bounces_hard (is_hard_bounce),
  INDEX idx_bounces_contact (crm_contact_id),
  INDEX idx_bounces_crqid (crqid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
