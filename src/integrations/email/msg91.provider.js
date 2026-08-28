const EmailProvider = require('./email-provider.interface');
const settingsService = require('../../modules/settings/settings.service');
const env = require('../../config/env');

class Msg91Provider extends EmailProvider {
  /**
   * Resolve MSG91 settings from system_settings (Redis/DB) with env fallback
   */
  async getConfig() {
    let settings = {};
    try {
      settings = await settingsService.getSettings();
    } catch (err) {
      console.warn('[Msg91Provider] Failed to fetch system_settings, falling back to env:', err.message);
    }

    const authKey = settings.msg91_auth_key || env.MSG91_AUTH_KEY || '';
    const domain = settings.msg91_domain || env.MSG91_DOMAIN || '';
    const fromEmail = settings.msg91_from_email || env.MSG91_FROM_EMAIL || '';
    const fromName = settings.msg91_from_name || env.MSG91_FROM_NAME || 'RESOL CRM';
    const defaultTemplateId = settings.msg91_default_template_id || env.MSG91_DEFAULT_TEMPLATE_ID || '';

    return { authKey, domain, fromEmail, fromName, defaultTemplateId };
  }

  /**
   * Verify MSG91 credentials / settings
   * @param {Object} [customSettings]
   */
  async verifyConnection(customSettings = null) {
    let authKey, domain, fromEmail;

    if (customSettings && customSettings.msg91_auth_key) {
      authKey = customSettings.msg91_auth_key;
      domain = customSettings.msg91_domain;
      fromEmail = customSettings.msg91_from_email;
    } else {
      const config = await this.getConfig();
      authKey = config.authKey;
      domain = config.domain;
      fromEmail = config.fromEmail;
    }

    if (!authKey) {
      throw new Error('MSG91 Auth Key is required');
    }
    if (!domain) {
      throw new Error('MSG91 Sender Domain is required');
    }

    try {
      const response = await fetch('https://control.msg91.com/api/v5/email/send', {
        method: 'POST',
        headers: {
          'authkey': authKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          recipients: [],
          from: { name: 'CRM Verification Test', email: fromEmail || `noreply@${domain}` },
          domain: domain
        })
      });

      const resText = await response.text();
      let resJson;
      try { resJson = JSON.parse(resText); } catch { resJson = {}; }

      if (response.status === 401 || (resJson.type === 'error' && resJson.message && resJson.message.toLowerCase().includes('auth'))) {
        throw new Error(resJson.message || 'Invalid MSG91 Auth Key');
      }

      if (response.status === 400 && resJson.message && resJson.message.toLowerCase().includes('recipient')) {
        return { success: true, message: 'MSG91 Credentials & API connection verified successfully!' };
      }

      if (resJson.status === 'success' || response.ok) {
        return { success: true, message: 'MSG91 Credentials & API connection verified successfully!' };
      }

      if (resJson.message) {
        if (!resJson.message.toLowerCase().includes('auth') && !resJson.message.toLowerCase().includes('unauthorized')) {
          return { success: true, message: 'MSG91 API authentication successful!' };
        }
        throw new Error(resJson.message);
      }

      return { success: true, message: 'MSG91 API connection verified successfully!' };
    } catch (err) {
      if (err.message.includes('fetch failed')) {
        throw new Error(`Failed to reach MSG91 API endpoint: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Send single email via MSG91 API
   * @param {Object} options - { to, subject, html, text, from, fromName, templateId, variables }
   */
  async sendMail(options) {
    const { to, subject, html, text, from, fromName, templateId, variables } = options;
    const config = await this.getConfig();

    const authKey = (config.authKey || '').trim();
    const rawDomain = (config.domain || '').trim();
    const domain = rawDomain.replace(/^https?:\/\//i, '').split('/')[0].trim();

    let senderEmail = (from || config.fromEmail || '').trim();
    if (!senderEmail || !senderEmail.includes('@')) {
      senderEmail = domain ? `info@${domain}` : 'info@weprixe.in';
    }
    const senderName = (fromName || config.fromName || 'RESOL CRM').trim();

    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }
    if (!domain) {
      throw new Error('MSG91 Domain is not configured in system settings');
    }

    const recipientEmail = typeof to === 'object' ? to.email : to;
    const rawName = typeof to === 'object' ? to.name : '';
    const recipientName = (rawName && rawName.trim()) ? rawName.trim() : (recipientEmail ? recipientEmail.split('@')[0] : 'Recipient');

    const recipients = [
      {
        to: [
          {
            name: recipientName,
            email: recipientEmail ? recipientEmail.trim() : ''
          }
        ],
        variables: {
          subject: subject || '',
          body: html || text || '',
          html: html || '',
          text: text || '',
          name: recipientName,
          email: recipientEmail ? recipientEmail.trim() : '',
          ...(variables || {})
        }
      }
    ];

    const payload = {
      recipients,
      from: {
        name: senderName,
        email: senderEmail
      },
      domain: domain
    };

    if (options.crqid || options.crqId) {
      payload.crqid = options.crqid || options.crqId;
    }

    let msg91TemplateId = options.msg91_template_id || options.msg91TemplateId || config.defaultTemplateId || '';
    if (typeof msg91TemplateId === 'number' || (typeof msg91TemplateId === 'string' && /^\d+$/.test(msg91TemplateId.trim()))) {
      msg91TemplateId = ''; // Ignore internal numeric CRM database template ID
    } else if (typeof msg91TemplateId === 'string') {
      msg91TemplateId = msg91TemplateId.trim();
    }

    if (msg91TemplateId && msg91TemplateId.length > 0) {
      payload.template_id = msg91TemplateId;
    }

    const response = await fetch('https://control.msg91.com/api/v5/email/send', {
      method: 'POST',
      headers: {
        'authkey': authKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error' || resJson.errors) {
      console.error('[Msg91Provider] Send Email Error Response:', JSON.stringify(resJson), 'Payload:', JSON.stringify(payload));
      let errMsg = resJson.message || resJson.errors || `MSG91 Email send failed with status ${response.status}`;
      if (typeof errMsg === 'object') {
        errMsg = JSON.stringify(errMsg);
      }
      throw new Error(`MSG91 API Error: ${errMsg}`);
    }

    return {
      success: true,
      messageId: resJson.request_id || resJson.message_id || `msg91_${Date.now()}`,
      provider: 'msg91',
      raw: resJson
    };
  }

  async sendTransactional(options) {
    return this.sendMail(options);
  }

  /**
   * Bulk campaign dispatch via MSG91 Email API in batches
   */
  async sendCampaign(campaign) {
    const { subject, bodyHtml, recipients, templateId } = campaign;
    const config = await this.getConfig();

    const authKey = config.authKey;
    const domain = config.domain;
    const senderEmail = campaign.from || config.fromEmail || `info@${domain}`;
    const senderName = campaign.fromName || config.fromName || 'RESOL CRM';
    const targetTemplateId = templateId || campaign.template_id || config.defaultTemplateId;

    if (!authKey || !domain) {
      throw new Error('MSG91 Auth Key and Domain must be configured in system settings');
    }

    const batchSize = 500;
    const totalResults = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batchRecipients = recipients.slice(i, i + batchSize).map(r => {
        const item = {
          to: [
            {
              name: (r.name && r.name.trim()) ? r.name.trim() : (r.email ? r.email.split('@')[0] : 'Recipient'),
              email: r.email ? r.email.trim() : ''
            }
          ],
          variables: {
            subject: subject || '',
            body: bodyHtml || '',
            html: bodyHtml || '',
            name: r.name || '',
            email: r.email,
            ...(r.variables || {})
          }
        };
        if (r.crqid || r.crqId) {
          item.crqid = r.crqid || r.crqId;
        }
        return item;
      });

      const payload = {
        recipients: batchRecipients,
        from: {
          name: senderName,
          email: senderEmail
        },
        domain: domain
      };

      let msg91TemplateId = campaign.msg91_template_id || campaign.msg91TemplateId || config.defaultTemplateId || '';
      if (typeof msg91TemplateId === 'number' || (typeof msg91TemplateId === 'string' && /^\d+$/.test(msg91TemplateId.trim()))) {
        msg91TemplateId = ''; // Ignore internal numeric CRM database template ID
      } else if (typeof msg91TemplateId === 'string') {
        msg91TemplateId = msg91TemplateId.trim();
      }

      if (msg91TemplateId && msg91TemplateId.length > 0) {
        payload.template_id = msg91TemplateId;
      }

      const response = await fetch('https://control.msg91.com/api/v5/email/send', {
        method: 'POST',
        headers: {
          'authkey': authKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resText = await response.text();
      let resJson;
      try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

      if (!response.ok || resJson.type === 'error' || resJson.status === 'error') {
        const errMsg = resJson.message || resJson.errors || `MSG91 Campaign batch send failed with status ${response.status}`;
        throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
      }

      totalResults.push(resJson);
    }

    return {
      success: true,
      provider: 'msg91',
      sentCount: recipients.length,
      raw: totalResults
    };
  }
}

module.exports = new Msg91Provider();
