const EmailProvider = require('./email-provider.interface');
const settingsService = require('../../modules/settings/settings.service');
const env = require('../../config/env');
const db = require('../../config/db');

const MSG91_TEMPLATE_STATUS = {
  APPROVED: 2,
  REJECTED: 5
};

function getTemplateStatus(statusId) {
  const numericId = Number(statusId);
  if (numericId === 2) return "APPROVED";
  if (numericId === 5) return "REJECTED";
  return "PENDING";
}

/**
 * Normalizes MSG91 template/version status according to Section 1 & 6:
 */
function normalizeMsg91Status(template) {
  if (!template || typeof template !== 'object') {
    return {
      status: 'PENDING',
      msg91StatusId: null,
      isActive: false,
      isDraft: false,
      reasonId: null,
      usable: false
    };
  }

  let targetObj = template;
  if (Array.isArray(template.versions) && template.versions.length > 0) {
    const activeVer = template.versions.find(v => v && (v.is_active === true || v.is_active === 1 || v.is_active === '1')) || template.versions[0];
    if (activeVer) {
      targetObj = activeVer;
    }
  }

  const isDraft = Boolean(targetObj.is_draft === true || targetObj.is_draft === 1 || targetObj.is_draft === '1');
  const isActive = Boolean(targetObj.is_active === true || targetObj.is_active === 1 || targetObj.is_active === '1');
  const statusId = targetObj.status_id !== undefined && targetObj.status_id !== null ? Number(targetObj.status_id) : null;
  const status = getTemplateStatus(statusId);
  const usable = status === 'APPROVED';

  return {
    status,
    msg91StatusId: statusId,
    isActive,
    isDraft,
    reasonId: targetObj.reason_id !== undefined && targetObj.reason_id !== null ? targetObj.reason_id : null,
    usable
  };
}

class Msg91Provider extends EmailProvider {
  constructor() {
    super();
    this.name = 'msg91';
    this.provider = 'msg91';
  }

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

    let msg91TemplateId = options.msg91_template_id || options.msg91TemplateId || options.templateId || options.template_id || config.defaultTemplateId || '';
    if (typeof msg91TemplateId === 'number' || (typeof msg91TemplateId === 'string' && /^\d+$/.test(String(msg91TemplateId).trim()))) {
      msg91TemplateId = ''; // Ignore internal numeric CRM database template ID
    } else if (typeof msg91TemplateId === 'string') {
      msg91TemplateId = msg91TemplateId.trim();
    }

    if (!msg91TemplateId) {
      try {
        const [dbRows] = await db.query(
          'SELECT msg91_slug, msg91_template_id FROM email_templates WHERE (msg91_slug IS NOT NULL AND msg91_slug != "") OR (msg91_template_id IS NOT NULL AND msg91_template_id != "") ORDER BY id ASC LIMIT 1'
        );
        if (dbRows.length > 0) {
          msg91TemplateId = dbRows[0].msg91_slug || dbRows[0].msg91_template_id;
        }
      } catch (fErr) {
        console.warn('[Msg91Provider] Fallback template lookup skipped:', fErr.message);
      }
    }

    if (msg91TemplateId && msg91TemplateId.length > 0) {
      payload.template_id = msg91TemplateId;
      delete recipients[0].variables.body;
      delete recipients[0].variables.html;
      delete recipients[0].variables.text;
    } else {
      payload.body = {
        type: 'text/html',
        data: html || text || ''
      };
      if (subject) {
        payload.subject = subject;
      }
    }

    let response = await fetch('https://control.msg91.com/api/v5/email/send', {
      method: 'POST',
      headers: {
        'authkey': authKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    // If template is unverified on MSG91, retry with a verified template slug from DB
    if ((!response.ok || resJson.errors) && JSON.stringify(resJson).includes('is not verified') && payload.template_id) {
      console.warn(`[Msg91Provider] Template "${payload.template_id}" is unverified on MSG91. Retrying with fallback verified template...`);
      try {
        const [fbRows] = await db.query(
          'SELECT msg91_slug, msg91_template_id FROM email_templates WHERE (msg91_slug IS NOT NULL AND msg91_slug != "" AND msg91_slug != ?) ORDER BY id ASC LIMIT 1',
          [payload.template_id]
        );
        if (fbRows.length > 0) {
          payload.template_id = fbRows[0].msg91_slug || fbRows[0].msg91_template_id;
          response = await fetch('https://control.msg91.com/api/v5/email/send', {
            method: 'POST',
            headers: {
              'authkey': authKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          resText = await response.text();
          try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }
        }
      } catch (fbErr) {
        console.warn('[Msg91Provider] Retry with fallback template failed:', fbErr.message);
      }
    }

    const hasRealErrors = Boolean(
      resJson.hasError === true || 
      resJson.status === 'error' || 
      resJson.status === 'fail' || 
      resJson.type === 'error' || 
      (resJson.errors && typeof resJson.errors === 'object' && Object.keys(resJson.errors).length > 0)
    );

    if (!response.ok || hasRealErrors) {
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

      let msg91TemplateId = campaign.msg91_template_id || campaign.msg91TemplateId || campaign.templateId || campaign.template_id || config.defaultTemplateId || '';
      if (typeof msg91TemplateId === 'number' || (typeof msg91TemplateId === 'string' && /^\d+$/.test(String(msg91TemplateId).trim()))) {
        msg91TemplateId = ''; // Ignore internal numeric CRM database template ID
      } else if (typeof msg91TemplateId === 'string') {
        msg91TemplateId = msg91TemplateId.trim();
      }

      if (!msg91TemplateId) {
        try {
          const [dbRows] = await db.query(
            'SELECT msg91_slug, msg91_template_id FROM email_templates WHERE (msg91_slug IS NOT NULL AND msg91_slug != "") OR (msg91_template_id IS NOT NULL AND msg91_template_id != "") ORDER BY id ASC LIMIT 1'
          );
          if (dbRows.length > 0) {
            msg91TemplateId = dbRows[0].msg91_slug || dbRows[0].msg91_template_id;
          }
        } catch (fErr) {
          console.warn('[Msg91Provider] Campaign fallback template lookup skipped:', fErr.message);
        }
      }

      if (msg91TemplateId && msg91TemplateId.length > 0) {
        payload.template_id = msg91TemplateId;
        batchRecipients.forEach(r => {
          delete r.variables.body;
          delete r.variables.html;
          delete r.variables.text;
        });
      } else {
        payload.body = {
          type: 'text/html',
          data: bodyHtml || ''
        };
        if (subject) {
          payload.subject = subject;
        }
      }

      let response = await fetch('https://control.msg91.com/api/v5/email/send', {
        method: 'POST',
        headers: {
          'authkey': authKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      let resText = await response.text();
      let resJson;
      try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

      // If template is unverified on MSG91, retry with a verified template slug from DB
      if ((!response.ok || resJson.errors) && JSON.stringify(resJson).includes('is not verified') && payload.template_id) {
        console.warn(`[Msg91Provider] Campaign template "${payload.template_id}" is unverified on MSG91. Retrying with fallback template...`);
        try {
          const [fbRows] = await db.query(
            'SELECT msg91_slug, msg91_template_id FROM email_templates WHERE (msg91_slug IS NOT NULL AND msg91_slug != "" AND msg91_slug != ?) ORDER BY id ASC LIMIT 1',
            [payload.template_id]
          );
          if (fbRows.length > 0) {
            payload.template_id = fbRows[0].msg91_slug || fbRows[0].msg91_template_id;
            response = await fetch('https://control.msg91.com/api/v5/email/send', {
              method: 'POST',
              headers: {
                'authkey': authKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            resText = await response.text();
            try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }
          }
        } catch (fbErr) {
          console.warn('[Msg91Provider] Campaign retry with fallback template failed:', fbErr.message);
        }
      }

      const hasCampErrors = Boolean(
        resJson.hasError === true || 
        resJson.status === 'error' || 
        resJson.status === 'fail' || 
        resJson.type === 'error' || 
        (resJson.errors && typeof resJson.errors === 'object' && Object.keys(resJson.errors).length > 0)
      );

      if (!response.ok || hasCampErrors) {
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

  /**
   * Registers a new HTML email template in MSG91 via POST /api/v5/email/templates
   * Docs: https://docs.msg91.com/email/create-new-template
   */
  async createTemplateInMsg91(templateObj) {
    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();

    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }

    const name = templateObj.name || 'CRM Email Template';
    const slugName = templateObj.slug || templateObj.msg91_slug || (name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + (templateObj.id || Date.now()));
    const subject = templateObj.subject || '';
    const body = templateObj.body_html || templateObj.body || '';

    const payload = {
      name,
      slug: slugName,
      subject,
      body
    };

    const response = await fetch('https://control.msg91.com/api/v5/email/templates', {
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

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error' || resJson.hasError) {
      console.error('[Msg91Provider] Template Creation Failed:', JSON.stringify(resJson));
      const errMsg = resJson.message || resJson.errors || `Failed to create template in MSG91 (HTTP ${response.status})`;
      throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
    }

    const msg91Slug = resJson.data?.slug || resJson.slug || slugName;
    const msg91Id = resJson.data?.id || resJson.id || resJson.data?.template_id || msg91Slug;

    return {
      success: true,
      msg91_template_id: String(msg91Id),
      msg91_slug: String(msg91Slug),
      raw: resJson
    };
  }

  /**
   * Fetches list of all email templates registered in MSG91 account
   * Docs: https://docs.msg91.com/email/list-of-all-email-templates
   */
  async listTemplatesInMsg91(params = {}) {
    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();

    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }

    const queryParams = new URLSearchParams();
    queryParams.append('with', 'versions');
    if (params.status_id) queryParams.append('status_id', String(params.status_id));
    if (params.keyword) queryParams.append('keyword', String(params.keyword));
    if (params.search_in) queryParams.append('search_in', String(params.search_in));

    const response = await fetch(`https://control.msg91.com/api/v5/email/templates?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'authkey': authKey,
        'Accept': 'application/json'
      }
    });

    const resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error') {
      const errMsg = resJson.message || resJson.errors || `Failed to fetch MSG91 templates (HTTP ${response.status})`;
      throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
    }

    let list = [];
    if (Array.isArray(resJson)) {
      list = resJson;
    } else if (Array.isArray(resJson.data)) {
      list = resJson.data;
    } else if (Array.isArray(resJson.data?.data)) {
      list = resJson.data.data;
    } else if (Array.isArray(resJson.templates)) {
      list = resJson.templates;
    } else if (Array.isArray(resJson.data?.templates)) {
      list = resJson.data.templates;
    } else if (resJson.data && typeof resJson.data === 'object') {
      for (const key of Object.keys(resJson.data)) {
        if (Array.isArray(resJson.data[key])) {
          list = resJson.data[key];
          break;
        }
      }
    }

    return list;
  }

  /**
   * Fetches specific template version details from MSG91
   * Docs: GET https://control.msg91.com/api/v5/email/template-versions/:TemplateVersionIdHere?with=template
   */
  async getTemplateVersionDetails(versionId) {
    if (!versionId) {
      throw new Error('Validation Error: MSG91 Template Version ID is required');
    }

    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();

    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }

    const versionIdStr = String(versionId).trim();
    const url = `https://control.msg91.com/api/v5/email/template-versions/${encodeURIComponent(versionIdStr)}?with=template`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'authkey': authKey,
        'Accept': 'application/json'
      }
    });

    const resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error') {
      const errMsg = resJson.message || resJson.errors || `Failed to fetch template version ${versionIdStr} (HTTP ${response.status})`;
      throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
    }

    const versionData = resJson.data || resJson.version || resJson;
    const normalized = normalizeMsg91Status(versionData);

    return {
      version_id: String(versionIdStr),
      template_id: versionData.template_id ? String(versionData.template_id) : null,
      version_name: versionData.name || versionData.version_name || null,
      subject: versionData.subject || null,
      body: versionData.body || null,
      variables: versionData.variables || null,
      ...normalized,
      raw: resJson
    };
  }

  /**
   * Fetches specific template details and live approval status from MSG91
   * Docs: https://docs.msg91.com/email/email-template-details
   */
  async getTemplateDetailsInMsg91(slug) {
    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();
    if (!authKey || !slug) return null;

    try {
      const response = await fetch(`https://control.msg91.com/api/v5/email/templates/${slug}`, {
        method: 'GET',
        headers: {
          'authkey': authKey,
          'Accept': 'application/json'
        }
      });
      if (!response.ok) return null;
      const resJson = await response.json();
      return resJson.data || resJson;
    } catch (err) {
      console.warn(`[Msg91Provider] Failed to fetch template details for slug "${slug}":`, err.message);
      return null;
    }
  }

  /**
   * Fetches Email Logs directly from MSG91 REST API
   * Docs: https://docs.msg91.com/email/email-logs
   */
  async getEmailLogsFromMsg91(params = {}) {
    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();
    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }

    const query = new URLSearchParams();
    if (params.fromDate) query.append('fromDate', params.fromDate);
    if (params.toDate) query.append('toDate', params.toDate);
    if (params.page) query.append('page', String(params.page));
    if (params.limit) query.append('limit', String(params.limit));
    if (params.status) query.append('status', params.status);
    if (params.email) query.append('email', params.email);

    const url = `https://control.msg91.com/api/v5/email/logs?${query.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'authkey': authKey,
        'Accept': 'application/json'
      }
    });

    const resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error') {
      const errMsg = resJson.message || resJson.errors || `Failed to fetch MSG91 Email Logs (HTTP ${response.status})`;
      throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
    }

    return resJson.data || resJson.logs || resJson;
  }

  /**
   * Fetches Email Analytics & Aggregates directly from MSG91 REST API
   * Docs: https://docs.msg91.com/email/email-analytics
   */
  async getEmailAnalyticsFromMsg91(params = {}) {
    const config = await this.getConfig();
    const authKey = (config.authKey || '').trim();
    if (!authKey) {
      throw new Error('MSG91 Auth Key is not configured in system settings');
    }

    const query = new URLSearchParams();
    if (params.fromDate) query.append('fromDate', params.fromDate);
    if (params.toDate) query.append('toDate', params.toDate);
    if (params.domain) query.append('domain', params.domain);

    const url = `https://control.msg91.com/api/v5/email/analytics?${query.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'authkey': authKey,
        'Accept': 'application/json'
      }
    });

    const resText = await response.text();
    let resJson;
    try { resJson = JSON.parse(resText); } catch { resJson = { raw: resText }; }

    if (!response.ok || resJson.type === 'error' || resJson.status === 'error') {
      const errMsg = resJson.message || resJson.errors || `Failed to fetch MSG91 Email Analytics (HTTP ${response.status})`;
      throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
    }

    return resJson.data || resJson.analytics || resJson;
  }
}

const instance = new Msg91Provider();
instance.normalizeMsg91Status = normalizeMsg91Status;
instance.MSG91_TEMPLATE_STATUS = MSG91_TEMPLATE_STATUS;
instance.getTemplateStatus = getTemplateStatus;
module.exports = instance;
