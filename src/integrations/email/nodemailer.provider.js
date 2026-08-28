const nodemailer = require('nodemailer');
const EmailProvider = require('./email-provider.interface');
const settingsService = require('../../modules/settings/settings.service');
const env = require('../../config/env');

class NodemailerProvider extends EmailProvider {
  constructor() {
    super();
    this.name = 'nodemailer';
    this.provider = 'nodemailer';
  }

  /**
   * Resolve SMTP settings from system_settings (Redis/DB) with env fallback
   */
  async getTransporterConfig() {
    let settings = {};
    try {
      settings = await settingsService.getSettings();
    } catch (err) {
      console.warn('[NodemailerProvider] Failed to fetch system_settings, falling back to env:', err.message);
    }

    const host = settings.smtp_host || env.SMTP_HOST;
    const port = parseInt(settings.smtp_port || env.SMTP_PORT, 10);
    const secure = settings.smtp_secure !== undefined 
      ? (settings.smtp_secure === true || settings.smtp_secure === 'true') 
      : env.SMTP_SECURE;
    const user = settings.smtp_user || env.SMTP_USER;
    const pass = settings.smtp_pass || env.SMTP_PASS;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined
    });

    const fromEmail = settings.smtp_from_email || env.SMTP_FROM_EMAIL || user;
    const fromName = settings.smtp_from_name || env.SMTP_FROM_NAME || 'RESOL CRM';

    return { transporter, fromEmail, fromName };
  }

  /**
   * Verify SMTP credentials/connection
   * @param {Object} [customSettings]
   */
  async verifyConnection(customSettings = null) {
    let transporter;

    if (customSettings && customSettings.smtp_host) {
      transporter = nodemailer.createTransport({
        host: customSettings.smtp_host,
        port: parseInt(customSettings.smtp_port || 587, 10),
        secure: customSettings.smtp_secure === true || customSettings.smtp_secure === 'true',
        auth: customSettings.smtp_user && customSettings.smtp_pass ? {
          user: customSettings.smtp_user,
          pass: customSettings.smtp_pass
        } : undefined
      });
    } else {
      const config = await this.getTransporterConfig();
      transporter = config.transporter;
    }

    await transporter.verify();
    return { success: true, message: 'SMTP Connection verified successfully!' };
  }

  /**
   * Send single transactional/campaign email via Nodemailer
   * @param {Object} options - { to, subject, html, text, from, fromName }
   */
  async sendMail(options) {
    const { to, subject, html, text, from, fromName } = options;
    const config = await this.getTransporterConfig();

    const senderEmail = from || config.fromEmail;
    const senderName = fromName || config.fromName;
    const fromHeader = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;

    const info = await config.transporter.sendMail({
      from: fromHeader,
      to,
      subject,
      text: text || undefined,
      html: html || undefined
    });

    return {
      success: true,
      messageId: info.messageId,
      provider: 'nodemailer',
      raw: info
    };
  }

  async sendTransactional(options) {
    return this.sendMail(options);
  }

  async sendCampaign(campaign) {
    const { subject, bodyHtml, recipients } = campaign;
    const results = [];

    for (const r of recipients) {
      const res = await this.sendMail({
        to: r.email,
        subject,
        html: bodyHtml
      });
      results.push(res);
    }

    return {
      success: true,
      provider: 'nodemailer',
      sentCount: results.length
    };
  }
}

module.exports = new NodemailerProvider();
