require('dotenv').config();

const requiredEnvs = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.warn(`Warning: Environment variable ${env} is missing.`);
  }
}

module.exports = {
  PORT: process.env.PORT || 9822,
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || 'rseditz@222',
  DB_NAME: process.env.DB_NAME || 'vishalji_crm',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA', // dummy test key
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || '',
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'RESOL CRM',
  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY || '',
  MSG91_DOMAIN: process.env.MSG91_DOMAIN || '',
  MSG91_FROM_EMAIL: process.env.MSG91_FROM_EMAIL || '',
  MSG91_FROM_NAME: process.env.MSG91_FROM_NAME || 'RESOL CRM',
  MSG91_DEFAULT_TEMPLATE_ID: process.env.MSG91_DEFAULT_TEMPLATE_ID || ''
};
