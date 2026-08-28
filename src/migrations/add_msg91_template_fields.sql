-- SQL Migration for MSG91 Email Template Integration
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS msg91_version_id VARCHAR(100) NULL AFTER msg91_slug,
  ADD COLUMN IF NOT EXISTS msg91_status VARCHAR(50) DEFAULT 'UNKNOWN' AFTER msg91_version_id,
  ADD COLUMN IF NOT EXISTS msg91_status_id INT NULL AFTER msg91_status,
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) DEFAULT 1 AFTER msg91_status_id,
  ADD COLUMN IF NOT EXISTS is_draft TINYINT(1) DEFAULT 0 AFTER is_active,
  ADD COLUMN IF NOT EXISTS reason_id VARCHAR(100) NULL AFTER is_draft,
  ADD COLUMN IF NOT EXISTS mail_type_id VARCHAR(100) NULL AFTER reason_id;

CREATE TABLE IF NOT EXISTS email_template_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  crm_template_id INT NOT NULL,
  msg91_version_id VARCHAR(100) NULL,
  msg91_template_id VARCHAR(100) NULL,
  version_name VARCHAR(150) NULL,
  subject VARCHAR(255) NULL,
  body LONGTEXT NULL,
  variables JSON NULL,
  template_version_status VARCHAR(50) DEFAULT 'UNKNOWN',
  is_active TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_crm_template (crm_template_id),
  KEY idx_msg91_version (msg91_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
