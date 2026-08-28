const db = require('../../config/db');
const settingsService = require('../settings/settings.service');
const auditService = require('../audit/audit.service');
const { getActiveEmailProvider, msg91Provider, nodemailerProvider } = require('../../integrations/email');

class MailService {
  async testConnection(customSettings = null) {
    const provider = await getActiveEmailProvider(customSettings?.email_provider);
    return provider.verifyConnection(customSettings);
  }

  async testMsg91Connection(customSettings = null) {
    return msg91Provider.verifyConnection(customSettings);
  }

  async testGMassConnection(customSettings = null) {
    return this.testConnection(customSettings);
  }

  // --- TEMPLATES ---
  async getTemplates() {
    const [rows] = await db.query('SELECT * FROM email_templates ORDER BY updated_at DESC');
    return rows;
  }

  async getTemplateById(id) {
    const [rows] = await db.query('SELECT * FROM email_templates WHERE id = ?', [id]);
    if (rows.length === 0) {
      const err = new Error('Email template not found');
      err.statusCode = 404;
      throw err;
    }
    return rows[0];
  }

  async createTemplate(payload, creatorId) {
    const { name, subject, body_html, design_json } = payload;
    if (!name || !subject || !body_html) {
      const err = new Error('Name, Subject, and HTML content are required');
      err.statusCode = 400;
      throw err;
    }

    const designStr = design_json ? JSON.stringify(design_json) : null;

    const [result] = await db.query(
      'INSERT INTO email_templates (name, subject, body_html, design_json, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, subject, body_html, designStr, creatorId]
    );

    let msg91TemplateId = null;
    let msg91Slug = null;

    try {
      const msg91Res = await msg91Provider.createTemplateInMsg91({
        id: result.insertId,
        name,
        subject,
        body_html
      });
      if (msg91Res?.msg91_template_id) {
        msg91TemplateId = msg91Res.msg91_template_id;
        msg91Slug = msg91Res.msg91_slug;
        await db.query(
          'UPDATE email_templates SET msg91_template_id = ?, msg91_slug = ? WHERE id = ?',
          [msg91TemplateId, msg91Slug, result.insertId]
        );
      }
    } catch (mErr) {
      console.warn('[MailService] MSG91 template sync skipped:', mErr.message);
    }

    await auditService.log({
      actorId: creatorId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_CREATE',
      entityType: 'email_template',
      entityId: result.insertId,
      meta: { name, subject, msg91TemplateId }
    });

    return this.getTemplateById(result.insertId);
  }

  async updateTemplate(id, payload, updaterId) {
    const { name, subject, body_html, design_json } = payload;
    const existing = await this.getTemplateById(id);

    const newName = name || existing.name;
    const newSubject = subject || existing.subject;
    const newBody = body_html !== undefined ? body_html : existing.body_html;
    const newDesign = design_json !== undefined ? (design_json ? JSON.stringify(design_json) : null) : existing.design_json;

    await db.query(
      'UPDATE email_templates SET name = ?, subject = ?, body_html = ?, design_json = ?, updated_at = NOW() WHERE id = ?',
      [newName, newSubject, newBody, newDesign, id]
    );

    try {
      const msg91Res = await msg91Provider.createTemplateInMsg91({
        id,
        name: newName,
        subject: newSubject,
        body_html: newBody,
        slug: existing.msg91_slug
      });
      if (msg91Res?.msg91_template_id) {
        await db.query(
          'UPDATE email_templates SET msg91_template_id = ?, msg91_slug = ? WHERE id = ?',
          [msg91Res.msg91_template_id, msg91Res.msg91_slug, id]
        );
      }
    } catch (mErr) {
      console.warn('[MailService] MSG91 template update sync skipped:', mErr.message);
    }

    await auditService.log({
      actorId: updaterId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_UPDATE',
      entityType: 'email_template',
      entityId: id,
      meta: { name: newName, subject: newSubject }
    });

    return this.getTemplateById(id);
  }

  async deleteTemplate(id, deleterId) {
    const existing = await this.getTemplateById(id);
    await db.query('DELETE FROM email_templates WHERE id = ?', [id]);

    await auditService.log({
      actorId: deleterId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_DELETE',
      entityType: 'email_template',
      entityId: id,
      meta: { name: existing.name }
    });

    return { success: true };
  }

  // --- MSG91 TEMPLATE SYNC & LIVE MAPPING ---
  async syncTemplateToMsg91(id, forceReupload = false) {
    const template = await this.getTemplateById(id);
    if (!template) {
      throw new Error(`Template #${id} not found`);
    }

    // If template already has a msg91_slug and we are not forcing re-upload, check its live status from MSG91
    if (template.msg91_slug && !forceReupload) {
      const details = await msg91Provider.getTemplateDetailsInMsg91(template.msg91_slug);
      if (details) {
        const liveStatus = details.status || details.approval_status || 'approved';
        return {
          ...template,
          msg91_status: liveStatus,
          alreadyExists: true
        };
      }
    }

    // Otherwise, post template to MSG91
    const result = await msg91Provider.createTemplateInMsg91({
      id: template.id,
      name: template.name,
      subject: template.subject,
      body_html: template.body_html,
      slug: template.msg91_slug
    });

    if (result?.msg91_template_id) {
      await db.query(
        'UPDATE email_templates SET msg91_template_id = ?, msg91_slug = ? WHERE id = ?',
        [result.msg91_template_id, result.msg91_slug, id]
      );
    }
    return this.getTemplateById(id);
  }

  async syncAllTemplatesToMsg91(forceReupload = false) {
    const templates = await this.getTemplates();
    const results = [];
    for (const t of templates) {
      try {
        const synced = await this.syncTemplateToMsg91(t.id, forceReupload);
        results.push({ id: t.id, name: t.name, status: 'synced', msg91_slug: synced.msg91_slug, msg91_status: synced.msg91_status || 'submitted' });
      } catch (err) {
        results.push({ id: t.id, name: t.name, status: 'error', error: err.message });
      }
    }
    return results;
  }

  async getMsg91TemplatesLive() {
    try {
      const liveTemplates = await msg91Provider.listTemplatesInMsg91();
      const localTemplates = await this.getTemplates();

      // Combine local template data with MSG91 live response
      const mapped = localTemplates.map(loc => {
        const slug = loc.msg91_slug || loc.msg91_template_id;
        let matchedLive = null;
        if (Array.isArray(liveTemplates)) {
          matchedLive = liveTemplates.find(lt => String(lt.slug) === String(slug) || String(lt.id) === String(slug) || String(lt.name).toLowerCase() === String(loc.name).toLowerCase());
        }
        return {
          id: loc.id,
          name: loc.name,
          subject: loc.subject,
          msg91_slug: loc.msg91_slug,
          msg91_template_id: loc.msg91_template_id,
          liveStatus: matchedLive ? (matchedLive.status || matchedLive.approval_status || 'approved') : (loc.msg91_slug ? 'pending' : 'not_uploaded'),
          matchedLive
        };
      });

      return { templates: mapped, rawMsg91: liveTemplates };
    } catch (err) {
      return { error: err.message };
    }
  }

  async getMsg91EmailLogs(params = {}) {
    try {
      return await msg91Provider.getEmailLogsFromMsg91(params);
    } catch (err) {
      console.error('[MailService] Error fetching MSG91 logs:', err.message);
      return { error: err.message };
    }
  }

  async getMsg91EmailAnalytics(params = {}) {
    try {
      return await msg91Provider.getEmailAnalyticsFromMsg91(params);
    } catch (err) {
      console.error('[MailService] Error fetching MSG91 analytics:', err.message);
      return { error: err.message };
    }
  }

  // --- VARIABLE INTERPOLATION ---
  interpolate(text, customer) {
    if (!text) return '';
    if (!customer) return text;

    return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      const val = customer[key] || customer[key.toLowerCase()];
      if (val !== undefined && val !== null) {
        return String(val);
      }
      if (key === 'staff_code') return customer.created_by_code || customer.staff_code || '';
      return '';
    });
  }

  // --- SEND EMAIL ---
  async sendMail(payload, senderId) {
    const { customerIds, customEmails, sendToAll, filterCriteria, templateId, subject, body_html } = payload;

    if (!subject || !body_html) {
      const err = new Error('Subject and Mail Body content are required');
      err.statusCode = 400;
      throw err;
    }

    // Build recipient list
    let recipientsList = []; // [{ email, name, user_id, customerObj }]

    if (sendToAll) {
      const [customers] = await db.query(
        `SELECT u.*, s.staff_code as created_by_code
         FROM users u
         LEFT JOIN staff s ON u.created_by = s.id
         WHERE u.email IS NOT NULL AND u.email != '' AND (u.is_opted_out IS NULL OR u.is_opted_out = 0) AND (u.email_invalid IS NULL OR u.email_invalid = 0)`
      );

      for (const cust of customers) {
        if (cust.email && cust.email.trim()) {
          recipientsList.push({
            email: cust.email.trim(),
            name: cust.name,
            user_id: cust.id,
            customerObj: cust
          });
        }
      }
    } else if (filterCriteria && typeof filterCriteria === 'object' && (filterCriteria.search || filterCriteria.staff_code || filterCriteria.tag1 || filterCriteria.city || filterCriteria.institute)) {
      const userService = require('../users/user.service');
      const customers = await userService.getAllUsersForExport('admin', senderId, filterCriteria);

      for (const cust of customers) {
        if (cust.email && cust.email.trim() && !cust.is_opted_out && !cust.email_invalid) {
          if (!recipientsList.some(r => r.email.toLowerCase() === cust.email.trim().toLowerCase())) {
            recipientsList.push({
              email: cust.email.trim(),
              name: cust.name,
              user_id: cust.id,
              customerObj: cust
            });
          }
        }
      }
    } else if (Array.isArray(customerIds) && customerIds.length > 0) {
      const [customers] = await db.query(
        `SELECT u.*, s.staff_code as created_by_code
         FROM users u
         LEFT JOIN staff s ON u.created_by = s.id
         WHERE u.id IN (?)`,
        [customerIds]
      );

      for (const cust of customers) {
        if (cust.email && cust.email.trim()) {
          recipientsList.push({
            email: cust.email.trim(),
            name: cust.name,
            user_id: cust.id,
            customerObj: cust
          });
        }
      }
    }

    if (Array.isArray(customEmails) && customEmails.length > 0) {
      for (const entry of customEmails) {
        const email = typeof entry === 'string' ? entry.trim() : entry.email;
        const name = typeof entry === 'object' ? entry.name : '';
        if (email && !recipientsList.some(r => r.email.toLowerCase() === email.toLowerCase())) {
          recipientsList.push({
            email,
            name: name || email,
            user_id: null,
            customerObj: { name: name || email, email }
          });
        }
      }
    }

    if (recipientsList.length === 0) {
      const err = new Error('No valid email recipients provided');
      err.statusCode = 400;
      throw err;
    }

    const campaignService = require('../campaigns/campaign.service');
    const campaignName = recipientsList.length === 1 
      ? `Direct Email - ${subject.slice(0, 40)}` 
      : `Compose Campaign - ${subject.slice(0, 40)}`;

    const campaign = await campaignService.createCampaign({
      name: campaignName,
      subject,
      templateId,
      bodyHtml: body_html
    }, senderId);

    const contactIds = recipientsList.map(r => r.user_id).filter(Boolean);
    const customEmailAddrs = recipientsList.filter(r => !r.user_id).map(r => r.email);

    await campaignService.addRecipients(campaign.id, {
      contactIds,
      customEmails: customEmailAddrs
    });

    const sendRes = await campaignService.sendCampaign(campaign.id, senderId);

    await auditService.log({
      actorId: senderId,
      actorRole: 'admin',
      action: 'EMAIL_CAMPAIGN_DISPATCHED',
      entityType: 'campaign',
      entityId: campaign.id,
      meta: { total: recipientsList.length }
    });

    return {
      success: true,
      campaignId: campaign.id,
      total: recipientsList.length,
      message: `Successfully dispatched campaign to ${recipientsList.length} recipient(s) via Nodemailer & BullMQ queue.`
    };
  }

  // --- QUEUE METRICS ---
  async getQueueStatus() {
    const { getQueueMetrics } = require('../../queues/email.queue');
    return getQueueMetrics();
  }

  // --- LOGS ---
  async getLogs(page = 1, limit = 20, search = '') {
    const offset = (page - 1) * limit;
    let baseQuery = 'FROM email_logs l LEFT JOIN staff s ON l.sent_by = s.id WHERE 1=1';
    const params = [];

    if (search) {
      baseQuery += ' AND (l.recipient_email LIKE ? OR l.recipient_name LIKE ? OR l.subject LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [rows] = await db.query(
      `SELECT l.*, s.name as sent_by_name ${baseQuery} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total ${baseQuery}`, params);

    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = new MailService();
