CREATE DATABASE IF NOT EXISTS vishalji_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vishalji_crm;

CREATE TABLE IF NOT EXISTS staff (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  staff_code    VARCHAR(4) UNIQUE NULL,
  role          ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  is_disabled   TINYINT(1) NOT NULL DEFAULT 0,
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_staff_role (role),
  INDEX idx_staff_disabled (is_disabled)
);

CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  designation     VARCHAR(150) NULL,
  department      VARCHAR(150) NULL,
  institute       VARCHAR(200) NULL,
  city            VARCHAR(100) NULL,
  state           VARCHAR(100) NULL,
  region_type     ENUM('indian','abroad') NULL,
  country_code    VARCHAR(10) NULL,
  email           VARCHAR(150) NULL,
  email_normalized VARCHAR(150) NULL,
  mobile          VARCHAR(20) NULL,
  mobile_normalized VARCHAR(20) NULL,
  status          ENUM('active','unverified') NOT NULL DEFAULT 'active',
  tag1            VARCHAR(255) NULL,
  tag2            VARCHAR(255) NULL,
  source          ENUM('manual','import','public_form') NOT NULL DEFAULT 'manual',
  created_by      INT UNSIGNED NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  remarks         TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_email_normalized (email_normalized),
  UNIQUE KEY uq_mobile_normalized (mobile_normalized),
  INDEX idx_users_created_by (created_by),
  INDEX idx_users_city (city),
  INDEX idx_users_region (region_type),
  INDEX idx_users_source (source),
  INDEX idx_users_status (status),
  FULLTEXT INDEX ft_users_search (name, institute, department)
);

CREATE TABLE IF NOT EXISTS archived_users (
  id                 BIGINT UNSIGNED PRIMARY KEY,
  name               VARCHAR(150) NOT NULL,
  designation        VARCHAR(150) NULL,
  department         VARCHAR(150) NULL,
  institute          VARCHAR(200) NULL,
  city               VARCHAR(100) NULL,
  state              VARCHAR(100) NULL,
  region_type        ENUM('indian','abroad') NULL,
  country_code       VARCHAR(10) NULL,
  email              VARCHAR(150) NULL,
  mobile             VARCHAR(20) NULL,
  status             ENUM('active','unverified') NULL,
  tag1               VARCHAR(255) NULL,
  tag2               VARCHAR(255) NULL,
  source             ENUM('manual','import','public_form') NOT NULL,
  original_created_by INT UNSIGNED NULL,
  original_created_at DATETIME NOT NULL,
  deleted_by         INT UNSIGNED NOT NULL,
  deletion_reason    VARCHAR(255) NULL,
  archived_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_archived_deleted_by (deleted_by)
);

CREATE TABLE IF NOT EXISTS user_queries (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  query_text    TEXT NULL,
  remark        TEXT NULL,
  source         ENUM('manual','import','public_form','staff_remark') NOT NULL,
  payload_snapshot JSON NULL,
  created_by     INT UNSIGNED NULL,
  is_duplicate_log TINYINT(1) DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uq_user_id (user_id),
  INDEX idx_uq_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  requested_by  INT UNSIGNED NOT NULL,
  reason        VARCHAR(255) NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by   INT UNSIGNED NULL,
  reviewed_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dr_user_id (user_id),
  INDEX idx_dr_status (status)
);

CREATE TABLE IF NOT EXISTS system_settings (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key   VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL,
  updated_by    INT UNSIGNED NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename        VARCHAR(255) NOT NULL,
  total_rows      INT UNSIGNED NOT NULL DEFAULT 0,
  success_count   INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count     INT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('previewed','committed','failed') NOT NULL DEFAULT 'previewed',
  error_report    JSON NULL,
  uploaded_by     INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id       INT UNSIGNED NULL,
  actor_role     ENUM('admin','staff','public','system') NOT NULL,
  action         VARCHAR(100) NOT NULL,
  entity_type    VARCHAR(50) NULL,
  entity_id      VARCHAR(50) NULL,
  meta           JSON NULL,
  ip_address     VARCHAR(45) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_created_at (created_at)
);

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
);

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
);

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES 
  ('form_submission_enabled', 'true'),
  ('staff_scope', 'all'),
  ('staff_login_enabled', 'true'),
  ('smtp_host', 'smtp.gmail.com'),
  ('smtp_port', '587'),
  ('smtp_secure', 'false'),
  ('smtp_user', 'ithyaraa.official@gmail.com'),
  ('smtp_pass', 'kvolsposhoxctyto'),
  ('smtp_from_email', 'ithyaraa.official@gmail.com'),
  ('smtp_from_name', 'ithyaraa');


