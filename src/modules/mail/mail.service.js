const nodemailer = require('nodemailer');
const db = require('../../config/db');
const settingsService = require('../settings/settings.service');
const auditService = require('../audit/audit.service');

class MailService {
  async getTransporter(customConfig = null) {
    let settings = customConfig;
    if (!settings) {
      settings = await settingsService.getSettings();
    }

    const host = settings.smtp_host || process.env.SMTP_HOST;
    const port = parseInt(settings.smtp_port || process.env.SMTP_PORT || 587);
    const secure = (settings.smtp_secure === true || settings.smtp_secure === 'true' || String(settings.smtp_secure) === '1');
    const user = settings.smtp_user || process.env.SMTP_USER;
    const pass = settings.smtp_pass || process.env.SMTP_PASS;

    if (!host) {
      const err = new Error('SMTP host is not configured. Please complete SMTP settings first.');
      err.statusCode = 400;
      throw err;
    }

    const transportConfig = {
      host,
      port,
      secure,
      tls: {
        rejectUnauthorized: false
      }
    };

    if (user) {
      transportConfig.auth = { user, pass };
    }

    return {
      transporter: nodemailer.createTransport(transportConfig),
      fromEmail: settings.smtp_from_email || user || 'no-reply@example.com',
      fromName: settings.smtp_from_name || 'RESOL CRM'
    };
  }

  async testConnection(config) {
    const { transporter } = await this.getTransporter(config);
    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully!' };
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

    await auditService.log({
      actorId: creatorId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_CREATE',
      entityType: 'email_template',
      entityId: result.insertId,
      meta: { name, subject }
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
    const { customerIds, customEmails, templateId, subject, body_html } = payload;

    if (!subject || !body_html) {
      const err = new Error('Subject and Mail Body content are required');
      err.statusCode = 400;
      throw err;
    }

    // Build recipient list
    let recipientsList = []; // [{ email, name, user_id, customerObj }]

    if (Array.isArray(customerIds) && customerIds.length > 0) {
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

    const { emailQueue } = require('../../queues/email.queue');

    let queuedCount = 0;
    for (const item of recipientsList) {
      const finalSubject = this.interpolate(subject, item.customerObj);

      // Create initial log entry in MySQL
      const [result] = await db.query(
        `INSERT INTO email_logs (recipient_email, recipient_name, user_id, template_id, subject, status, sent_by)
         VALUES (?, ?, ?, ?, ?, 'failed', ?)`,
        [item.email, item.name || null, item.user_id || null, templateId || null, finalSubject, senderId]
      );

      const logId = result.insertId;

      // Enqueue job to BullMQ
      await emailQueue.add('sendEmailItem', {
        logId,
        recipient: item,
        subject,
        bodyHtml: body_html,
        templateId,
        senderId
      });

      queuedCount++;
    }

    await auditService.log({
      actorId: senderId,
      actorRole: 'admin',
      action: 'EMAIL_DISPATCH_QUEUED',
      entityType: 'email',
      meta: { total: recipientsList.length, queued: queuedCount, templateId }
    });

    return {
      queued: true,
      total: recipientsList.length,
      message: `Successfully queued ${queuedCount} email(s) for background processing via BullMQ.`
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
