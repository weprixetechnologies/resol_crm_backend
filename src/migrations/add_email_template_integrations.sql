-- Migration script for MSG91 Email Template Integrations
-- Dedicated integration mapping table for CRM ↔ MSG91 relationship

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

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS slug VARCHAR(200) NULL AFTER name,
  ADD COLUMN IF NOT EXISTS variables JSON NULL AFTER body_html,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'PENDING' AFTER variables,
  ADD COLUMN IF NOT EXISTS is_uploaded TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
