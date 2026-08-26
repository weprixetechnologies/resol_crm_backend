-- =========================================================
-- SQL Migration Script for RESOL CRM Email System
-- Database: vishalji_crm
-- Description: Adds email_templates, email_logs tables & SMTP settings keys
-- =========================================================

USE vishalji_crm;

-- 1. Create email_templates table for custom templates
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

-- 2. Create email_logs table for audit delivery tracking
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

-- 3. Email system initialized with GMass as default email integration

