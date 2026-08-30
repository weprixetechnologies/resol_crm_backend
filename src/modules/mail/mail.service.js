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
    // Stale status refresh for templates whose status wasn't checked in 5 minutes
    try {
      const [staleRows] = await db.query(
        `SELECT crm_template_id FROM email_template_integrations 
         WHERE provider = 'MSG91' AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL 5 MINUTE)`
      );
      for (const row of staleRows) {
        await this.getTemplateStatus(row.crm_template_id).catch(() => {});
      }
    } catch (sErr) {
      console.warn('[MailService] Background stale status check warning:', sErr.message);
    }

    const [rows] = await db.query(
      `SELECT t.*, 
              i.msg91_template_id, 
              i.msg91_version_id, 
              i.msg91_status_id, 
              i.provider_status, 
              i.last_synced_at 
       FROM email_templates t 
       LEFT JOIN email_template_integrations i ON t.id = i.crm_template_id AND i.provider = 'MSG91' 
       ORDER BY t.updated_at DESC`
    );

    const templates = rows.map(t => {
      const status = t.provider_status || t.status || 'PENDING';
      const canSend = (status === 'APPROVED');
      const item = {
        id: t.id,
        crmTemplateId: t.id,
        name: t.name,
        slug: t.slug || t.msg91_slug || null,
        subject: t.subject,
        body: t.body_html,
        body_html: t.body_html,
        variables: typeof t.variables === 'string' ? JSON.parse(t.variables) : (t.variables || []),
        design_json: typeof t.design_json === 'string' ? JSON.parse(t.design_json) : (t.design_json || null),
        status,
        canSend,
        isUploaded: Boolean(t.is_uploaded),
        createdAt: t.created_at,
        updatedAt: t.updated_at
      };

      // Rule 7 & 8: Surface MSG91 template ID ONLY if template is approved!
      if (canSend && (t.msg91_template_id || t.msg91_slug)) {
        item.msg91TemplateId = t.msg91_template_id || t.msg91_slug;
      }

      return item;
    });

    return templates;
  }

  async getTemplateById(id) {
    const [rows] = await db.query(
      `SELECT t.*, 
              i.msg91_template_id, 
              i.msg91_version_id, 
              i.msg91_status_id, 
              i.provider_status, 
              i.last_synced_at 
       FROM email_templates t 
       LEFT JOIN email_template_integrations i ON t.id = i.crm_template_id AND i.provider = 'MSG91' 
       WHERE t.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      const err = new Error('Email template not found');
      err.statusCode = 404;
      throw err;
    }

    const t = rows[0];
    const status = t.provider_status || t.status || 'PENDING';
    const canSend = (status === 'APPROVED');

    const item = {
      id: t.id,
      crmTemplateId: t.id,
      name: t.name,
      slug: t.slug || t.msg91_slug || null,
      subject: t.subject,
      body: t.body_html,
      body_html: t.body_html,
      variables: typeof t.variables === 'string' ? JSON.parse(t.variables) : (t.variables || []),
      design_json: typeof t.design_json === 'string' ? JSON.parse(t.design_json) : (t.design_json || null),
      status,
      canSend,
      isUploaded: Boolean(t.is_uploaded),
      createdAt: t.created_at,
      updatedAt: t.updated_at
    };

    // Rule 7 & 8: Surface MSG91 template ID ONLY if template is approved!
    if (canSend && (t.msg91_template_id || t.msg91_slug)) {
      item.msg91TemplateId = t.msg91_template_id || t.msg91_slug;
    }

    return item;
  }

  async createTemplate(payload, creatorId) {
    const { name, subject, body, body_html, design_json, variables } = payload;
    const htmlContent = body_html || body || '';

    // Step 1: Validate request
    if (!name || !name.trim()) {
      const err = new Error('Template Name is required');
      err.statusCode = 400;
      throw err;
    }
    if (!subject || !subject.trim()) {
      const err = new Error('Email Subject is required');
      err.statusCode = 400;
      throw err;
    }
    if (!htmlContent || !htmlContent.trim()) {
      const err = new Error('HTML Body content is required');
      err.statusCode = 400;
      throw err;
    }

    // Extract variables from subject and body
    const varRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const extractedVars = new Set();
    let match;
    while ((match = varRegex.exec(subject + ' ' + htmlContent)) !== null) {
      extractedVars.add(match[1]);
    }
    const finalVars = Array.from(extractedVars);

    const slugName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + Date.now();
    const designStr = design_json ? JSON.stringify(design_json) : null;
    const varsStr = JSON.stringify(variables || finalVars);

    // Step 2: Create template in our CRM database first
    const [result] = await db.query(
      `INSERT INTO email_templates (name, slug, subject, body_html, variables, status, is_uploaded, design_json, created_by) 
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
      [name.trim(), slugName, subject.trim(), htmlContent, varsStr, designStr, creatorId]
    );

    const crmTemplateId = result.insertId;
    let msg91Res = null;
    let msg91Error = null;

    // Step 3: Call MSG91 template creation API from backend
    try {
      msg91Res = await msg91Provider.createTemplateInMsg91({
        id: crmTemplateId,
        name: name.trim(),
        slug: slugName,
        subject: subject.trim(),
        body_html: htmlContent
      });
    } catch (mErr) {
      msg91Error = mErr;
      console.error(`[MailService] MSG91 Template Creation API failed for crmTemplateId #${crmTemplateId}:`, mErr.message);
    }

    // Case B: MSG91 creation fails
    if (!msg91Res || !msg91Res.msg91_template_id) {
      await db.query(`UPDATE email_templates SET status = 'FAILED', is_uploaded = 0 WHERE id = ?`, [crmTemplateId]);
      const err = new Error(msg91Error ? msg91Error.message : 'Failed to create template on MSG91');
      err.statusCode = 502;
      throw err;
    }

    // Step 4: Process MSG91 creation response & save relationship
    const { msg91_template_id, msg91_version_id, msg91_status_id, status } = msg91Res;
    const templateSlug = msg91Res.msg91_slug || slugName || String(msg91_template_id);

    try {
      await db.query(
        `INSERT INTO email_template_integrations 
         (crm_template_id, provider, msg91_template_id, msg91_version_id, msg91_status_id, provider_status, last_synced_at)
         VALUES (?, 'MSG91', ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           msg91_template_id = VALUES(msg91_template_id),
           msg91_version_id = VALUES(msg91_version_id),
           msg91_status_id = VALUES(msg91_status_id),
           provider_status = VALUES(provider_status),
           last_synced_at = NOW()`,
        [crmTemplateId, templateSlug, msg91_version_id ? String(msg91_version_id) : null, msg91_status_id, status]
      );

      // Flag as uploaded so it is never uploaded again
      await db.query(
        `UPDATE email_templates SET is_uploaded = 1, status = ?, msg91_template_id = ?, msg91_slug = ? WHERE id = ?`,
        [status, templateSlug, templateSlug, crmTemplateId]
      );
    } catch (dbErr) {
      // Case C: MSG91 creates template but database mapping fails
      console.error(`[CRITICAL INTEGRATION ERROR] MSG91 template created (${msg91_template_id}) but database mapping failed for crmTemplateId ${crmTemplateId}:`, dbErr.message);
      throw dbErr;
    }

    await auditService.log({
      actorId: creatorId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_CREATE',
      entityType: 'email_template',
      entityId: crmTemplateId,
      meta: { name, subject, crmTemplateId, msg91_template_id }
    });

    const canSend = (status === 'APPROVED');
    const responsePayload = {
      success: true,
      crmTemplateId,
      status,
      canSend
    };

    // Rule 7: MSG91 template ID ONLY returned if approved!
    if (canSend) {
      responsePayload.msg91TemplateId = String(msg91_template_id);
    }

    return responsePayload;
  }

  async updateTemplate(id, payload, updaterId) {
    const { name, subject, body_html, body, design_json, variables } = payload;
    const existing = await this.getTemplateById(id);
    const numericId = parseInt(id, 10);

    const newName = name ? name.trim() : existing.name;
    const newSubject = subject ? subject.trim() : existing.subject;
    const newBody = body_html !== undefined ? body_html : (body !== undefined ? body : existing.body_html);
    const newDesign = design_json !== undefined ? (design_json ? JSON.stringify(design_json) : null) : (existing.design_json ? JSON.stringify(existing.design_json) : null);
    const newVars = variables ? JSON.stringify(variables) : (existing.variables ? JSON.stringify(existing.variables) : null);

    await db.query(
      'UPDATE email_templates SET name = ?, subject = ?, body_html = ?, design_json = ?, variables = ?, updated_at = NOW() WHERE id = ?',
      [newName, newSubject, newBody, newDesign, newVars, numericId]
    );

    // If template has not been uploaded to MSG91 yet, upload it now
    const [tplRows] = await db.query('SELECT is_uploaded FROM email_templates WHERE id = ?', [numericId]);
    const isUploaded = tplRows.length > 0 && Boolean(tplRows[0].is_uploaded);

    if (!isUploaded) {
      try {
        const msg91Res = await msg91Provider.createTemplateInMsg91({
          id: numericId,
          name: newName,
          subject: newSubject,
          body_html: newBody,
          slug: existing.slug || existing.msg91_slug
        });

        if (msg91Res?.msg91_template_id) {
          const { msg91_template_id, msg91_version_id, msg91_status_id, status } = msg91Res;
          await db.query(
            `INSERT INTO email_template_integrations 
             (crm_template_id, provider, msg91_template_id, msg91_version_id, msg91_status_id, provider_status, last_synced_at)
             VALUES (?, 'MSG91', ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE msg91_version_id = VALUES(msg91_version_id), msg91_status_id = VALUES(msg91_status_id), provider_status = VALUES(provider_status), last_synced_at = NOW()`,
            [numericId, String(msg91_template_id), msg91_version_id ? String(msg91_version_id) : null, msg91_status_id, status]
          );
          await db.query(
            `UPDATE email_templates SET is_uploaded = 1, status = ?, msg91_template_id = ?, msg91_slug = ? WHERE id = ?`,
            [status, String(msg91_template_id), msg91Res.msg91_slug, numericId]
          );
        }
      } catch (mErr) {
        console.warn(`[MailService] MSG91 initial upload during update failed for template #${numericId}:`, mErr.message);
      }
    }

    await auditService.log({
      actorId: updaterId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_UPDATE',
      entityType: 'email_template',
      entityId: numericId,
      meta: { name: newName, subject: newSubject }
    });

    return this.getTemplateById(numericId);
  }

  async deleteTemplate(id, deleterId) {
    const existing = await this.getTemplateById(id);
    const numericId = parseInt(id, 10);
    await db.query('DELETE FROM email_template_integrations WHERE crm_template_id = ?', [numericId]);
    await db.query('DELETE FROM email_templates WHERE id = ?', [numericId]);

    await auditService.log({
      actorId: deleterId,
      actorRole: 'admin',
      action: 'EMAIL_TEMPLATE_DELETE',
      entityType: 'email_template',
      entityId: numericId,
      meta: { name: existing.name }
    });

    return { success: true };
  }

  // --- NEW API: GET CRM TEMPLATE STATUS ---
  async getTemplateStatus(crmTemplateId) {
    const numericId = parseInt(crmTemplateId, 10);
    if (!numericId) {
      const err = new Error('Invalid CRM Template ID');
      err.statusCode = 400;
      throw err;
    }

    // Step 1: Find CRM template
    const [tplRows] = await db.query('SELECT * FROM email_templates WHERE id = ?', [numericId]);
    if (tplRows.length === 0) {
      const err = new Error(`CRM Template #${numericId} not found`);
      err.statusCode = 404;
      throw err;
    }
    const tpl = tplRows[0];

    // Step 2: Find MSG91 integration mapping
    const [intRows] = await db.query(
      'SELECT * FROM email_template_integrations WHERE crm_template_id = ? AND provider = "MSG91"',
      [numericId]
    );

    const integration = intRows.length > 0 ? intRows[0] : null;
    const msg91TemplateId = integration?.msg91_template_id || tpl.msg91_template_id || tpl.msg91_slug;
    const msg91VersionId = integration?.msg91_version_id || tpl.msg91_version_id;

    if (!msg91TemplateId) {
      return {
        success: true,
        crmTemplateId: numericId,
        status: 'PENDING',
        canSend: false
      };
    }

    // Step 3: Call MSG91 to fetch live template details / versions
    let liveTemplates = [];
    try {
      liveTemplates = await msg91Provider.listTemplatesInMsg91();
    } catch (apiErr) {
      console.warn(`[MailService] Live MSG91 status query warning for template #${numericId}:`, apiErr.message);
    }

    // Step 4: Find exact MSG91 template using stored msg91_template_id
    let matchedTemplate = null;
    if (Array.isArray(liveTemplates)) {
      matchedTemplate = liveTemplates.find(lt =>
        String(lt.id) === String(msg91TemplateId) ||
        String(lt.template_id) === String(msg91TemplateId) ||
        String(lt.slug) === String(msg91TemplateId)
      );
    }

    // Step 5: Find relevant version using stored msg91_version_id
    let targetVersion = null;
    if (matchedTemplate && Array.isArray(matchedTemplate.versions)) {
      if (msg91VersionId) {
        targetVersion = matchedTemplate.versions.find(v => String(v.id) === String(msg91VersionId) || String(v.version_id) === String(msg91VersionId));
      }
      if (!targetVersion) {
        targetVersion = matchedTemplate.versions.find(v => v.is_active === true || v.is_active === 1 || v.is_active === '1') || matchedTemplate.versions[0];
      }
    } else if (matchedTemplate) {
      targetVersion = matchedTemplate;
    }

    // Step 6: Map status & resolved MSG91 slug
    const statusId = targetVersion?.status_id !== undefined && targetVersion?.status_id !== null ? Number(targetVersion.status_id) : (integration?.msg91_status_id ?? null);
    const mappedStatus = msg91Provider.getTemplateStatus(statusId);
    const resolvedSlug = targetVersion?.slug || matchedTemplate?.slug || tpl.slug || tpl.msg91_slug || String(msg91TemplateId);

    // Step 7: Update database with resolved MSG91 slug as msg91_template_id
    if (integration) {
      await db.query(
        `UPDATE email_template_integrations 
         SET msg91_template_id = ?, msg91_status_id = ?, provider_status = ?, last_synced_at = NOW() 
         WHERE id = ?`,
        [resolvedSlug, statusId, mappedStatus, integration.id]
      );
    } else {
      await db.query(
        `INSERT INTO email_template_integrations 
         (crm_template_id, provider, msg91_template_id, msg91_version_id, msg91_status_id, provider_status, last_synced_at)
         VALUES (?, 'MSG91', ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE msg91_template_id = VALUES(msg91_template_id), msg91_status_id = VALUES(msg91_status_id), provider_status = VALUES(provider_status), last_synced_at = NOW()`,
        [numericId, resolvedSlug, msg91VersionId ? String(msg91VersionId) : null, statusId, mappedStatus]
      );
    }

    await db.query(`UPDATE email_templates SET status = ?, msg91_template_id = ?, msg91_slug = ? WHERE id = ?`, [mappedStatus, resolvedSlug, resolvedSlug, numericId]);

    const canSend = (mappedStatus === 'APPROVED');
    const responsePayload = {
      success: true,
      crmTemplateId: numericId,
      status: mappedStatus,
      canSend
    };

    // Rule 7: Surfacing MSG91 template slug ONLY if approved!
    if (mappedStatus === 'APPROVED') {
      responsePayload.msg91TemplateId = resolvedSlug;
    }

    // Rule 7: Very Important Frontend Response Rule
    if (mappedStatus === 'APPROVED') {
      responsePayload.msg91TemplateId = String(msg91TemplateId);
    } else if (mappedStatus === 'REJECTED') {
      responsePayload.reason = targetVersion?.reason || 'Template rejected by MSG91';
    }

    return responsePayload;
  }

  async syncTemplateToMsg91(id, forceReupload = false) {
    return this.getTemplateStatus(id);
  }

  async syncAllTemplatesToMsg91(forceReupload = false) {
    const templates = await this.getTemplates();
    const results = [];
    for (const t of templates) {
      try {
        const synced = await this.getTemplateStatus(t.id);
        results.push({ id: t.id, name: t.name, status: synced.status, canSend: synced.canSend });
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
      return { templates: localTemplates, rawMsg91: liveTemplates };
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
      console.warn('[MailService] MSG91 analytics notice:', err.message);
      return { success: false, message: err.message, data: [] };
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

  // --- NEW API: EMAIL SENDING ---
  async sendMail(payload, senderId) {
    const { crmTemplateId, templateId, recipients, from, customerIds, customEmails, sendToAll, filterCriteria, subject, body_html, body } = payload;
    const targetCrmTemplateId = crmTemplateId || templateId;

    let templateObj = null;
    let integrationObj = null;

    if (targetCrmTemplateId) {
      // Step 1: Find CRM template
      templateObj = await this.getTemplateById(targetCrmTemplateId).catch(() => null);
      if (!templateObj) {
        const err = new Error(`CRM Template #${targetCrmTemplateId} not found`);
        err.statusCode = 404;
        throw err;
      }

      // Step 2 & 3: Perform fresh status validation call regardless of cached status
      const statusRes = await this.getTemplateStatus(targetCrmTemplateId);

      // Step 4, 5 & Send Blocking Rules (Section 16)
      if (!statusRes.canSend || statusRes.status !== 'APPROVED') {
        if (statusRes.status === 'REJECTED') {
          const err = new Error('This email template has been rejected by MSG91.');
          err.statusCode = 422;
          err.code = 'TEMPLATE_REJECTED';
          err.status = 'REJECTED';
          err.canSend = false;
          throw err;
        } else {
          const err = new Error('This email template is not approved by MSG91.');
          err.statusCode = 422;
          err.code = 'TEMPLATE_NOT_APPROVED';
          err.status = 'PENDING';
          err.canSend = false;
          throw err;
        }
      }

      // Find integration record to obtain stored msg91_template_id
      const [intRows] = await db.query(
        'SELECT * FROM email_template_integrations WHERE crm_template_id = ? AND provider = "MSG91"',
        [targetCrmTemplateId]
      );
      integrationObj = intRows[0];
    }

    const isValidEmail = (emailStr) => {
      if (!emailStr || typeof emailStr !== 'string') return false;
      const trimmed = emailStr.trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    };

    // Step 13: Resolve MSG91 template ID from database (NEVER accept template_id from frontend)
    const msg91TemplateId = integrationObj ? integrationObj.msg91_template_id : (templateObj ? templateObj.msg91TemplateId : null);

    // Build recipient list
    let recipientList = []; // [{ email, name, user_id, variables }]

    if (Array.isArray(recipients) && recipients.length > 0) {
      recipientList = recipients.map(r => {
        const e = typeof r === 'string' ? r.trim() : r.email?.trim();
        const n = typeof r === 'object' ? (r.name || '') : '';
        return {
          email: e || '',
          name: n,
          user_id: r.user_id || null,
          variables: r.variables || { name: n, email: e || '' }
        };
      }).filter(r => isValidEmail(r.email));
    } else if (sendToAll) {
      const [customers] = await db.query(
        `SELECT u.*, s.staff_code as created_by_code
         FROM users u
         LEFT JOIN staff s ON u.created_by = s.id
         WHERE u.email IS NOT NULL AND u.email != ''`
      );
      for (const cust of customers) {
        if (isValidEmail(cust.email)) {
          recipientList.push({
            email: cust.email.trim().toLowerCase(),
            name: cust.name,
            user_id: cust.id,
            variables: { name: cust.name, city: cust.city || '', institute: cust.institute || '', staff_code: cust.created_by_code || '' }
          });
        }
      }
    } else if (Array.isArray(customerIds) && customerIds.length > 0) {
      const [customers] = await db.query(
        `SELECT u.*, s.staff_code as created_by_code FROM users u LEFT JOIN staff s ON u.created_by = s.id WHERE u.id IN (?)`,
        [customerIds]
      );
      for (const cust of customers) {
        if (isValidEmail(cust.email)) {
          recipientList.push({
            email: cust.email.trim().toLowerCase(),
            name: cust.name,
            user_id: cust.id,
            variables: { name: cust.name, city: cust.city || '', institute: cust.institute || '', staff_code: cust.created_by_code || '' }
          });
        }
      }
    }

    if (Array.isArray(customEmails) && customEmails.length > 0) {
      for (const entry of customEmails) {
        const email = typeof entry === 'string' ? entry.trim() : entry.email;
        const name = typeof entry === 'object' ? entry.name : '';
        if (isValidEmail(email) && !recipientList.some(r => r.email.toLowerCase() === email.toLowerCase())) {
          recipientList.push({
            email: email.trim().toLowerCase(),
            name: name || email,
            user_id: null,
            variables: { name: name || email, email }
          });
        }
      }
    }

    if (recipientList.length === 0) {
      const err = new Error('No valid recipient email addresses provided (Check email format e.g. user@example.com)');
      err.statusCode = 400;
      throw err;
    }

    const mailSubject = subject || templateObj?.subject || 'Notification from RESOL CRM';
    const mailHtml = body_html || body || templateObj?.body_html || '';
    const fromSender = from || { name: 'RESOL CRM', email: 'hello@weprixe.in' };

    const activeProvider = await getActiveEmailProvider();

    // Log provider communication without authkey
    console.log(`[MailService] Pre-flight log creation for batch: crmTemplateId=${targetCrmTemplateId || 'none'}, msg91TemplateId=${msg91TemplateId || 'none'}, recipientsCount=${recipientList.length}`);

    // Pre-flight: Create individual email_logs and email_events BEFORE calling MSG91
    const preparedRecipients = [];
    for (const r of recipientList) {
      const crqid = `CRM_LOG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const varsJson = JSON.stringify(r.variables || {});

      const [insertRes] = await db.query(
        `INSERT INTO email_logs 
         (crqid, recipient_email, recipient_name, user_id, template_id, msg91_template_id, subject, variables, status, sent_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, NOW())`,
        [crqid, r.email, r.name || null, r.user_id || null, targetCrmTemplateId || null, msg91TemplateId || null, mailSubject, varsJson, senderId || null]
      );

      const logId = insertRes.insertId;

      await db.query(
        `INSERT INTO email_events (email_log_id, provider, event_name, event_status, event_timestamp, recipient, crqid)
         VALUES (?, 'MSG91', 'QUEUED', 'QUEUED', NOW(), ?, ?)`,
        [logId, r.email, crqid]
      );

      preparedRecipients.push({
        ...r,
        logId,
        crqid
      });
    }

    if (activeProvider.name === 'msg91' || activeProvider.provider === 'msg91') {
      const formattedRecipients = preparedRecipients.map(r => ({
        to: [
          {
            name: r.name || r.email.split('@')[0],
            email: r.email
          }
        ],
        crqid: r.crqid,
        variables: {
          name: r.name || '',
          email: r.email,
          ...(r.variables || {})
        }
      }));

      const msg91Payload = {
        recipients: formattedRecipients,
        from: {
          name: fromSender.name || 'RESOL CRM',
          email: fromSender.email || 'hello@weprixe.in'
        },
        templateId: msg91TemplateId,
        subject: mailSubject,
        html: mailHtml
      };

      try {
        const sendResult = await msg91Provider.sendMail(msg91Payload);
        const msgId = sendResult.messageId || null;
        const requestId = sendResult.raw?.request_id || sendResult.raw?.requestId || null;

        for (const r of preparedRecipients) {
          await db.query(
            `UPDATE email_logs SET msg_id = ?, request_id = ?, status = 'QUEUED' WHERE id = ?`,
            [msgId, requestId, r.logId]
          );
        }

        return {
          success: true,
          crmTemplateId: targetCrmTemplateId || null,
          totalRecipients: preparedRecipients.length,
          message: `Successfully dispatched email to ${preparedRecipients.length} recipient(s) via MSG91.`
        };
      } catch (sendErr) {
        for (const r of preparedRecipients) {
          await db.query(
            `UPDATE email_logs SET status = 'FAILED', failed_at = NOW(), failure_reason = ? WHERE id = ?`,
            [sendErr.message, r.logId]
          );
          await db.query(
            `INSERT INTO email_events (email_log_id, provider, event_name, event_status, event_timestamp, recipient, crqid)
             VALUES (?, 'MSG91', 'FAILED', 'FAILED', NOW(), ?, ?)`,
            [r.logId, r.email, r.crqid]
          );
        }
        throw sendErr;
      }
    }

    // Nodemailer / Queue Fallback
    const { emailQueue } = require('../../queues/email.queue');
    for (const r of preparedRecipients) {
      await emailQueue.add('sendEmail', {
        recipient: { email: r.email, name: r.name, user_id: r.user_id, customerObj: r.variables },
        subject: mailSubject,
        bodyHtml: mailHtml,
        templateId: targetCrmTemplateId,
        crqid: r.crqid,
        logId: r.logId,
        senderId
      });
    }

    return {
      success: true,
      crmTemplateId: targetCrmTemplateId || null,
      totalRecipients: preparedRecipients.length,
      message: `Queued ${preparedRecipients.length} email job(s) for background processing.`
    };
  }

  // --- NEW API: MSG91 ANALYTICS API (PART 3 & 4) ---
  async getAnalytics(startDate, endDate) {
    let msg91Data = null;
    let providerError = null;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
      if (diffDays <= 31) {
        try {
          msg91Data = await msg91Provider.getEmailAnalyticsFromMsg91({ startDate, endDate });
        } catch (err) {
          providerError = err.message;
          console.warn('[MailService] MSG91 Live Analytics fetch warning:', err.message);
        }
      }
    }

    // CRM Internal Database Aggregations for fallback / historical >31 days
    let dateFilterSql = '';
    const filterParams = [];
    if (startDate && endDate) {
      dateFilterSql = ' WHERE created_at >= ? AND created_at <= ?';
      filterParams.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    const [[counts]] = await db.query(
      `SELECT 
        COUNT(*) as total_sent,
        SUM(CASE WHEN LOWER(status) = 'delivered' THEN 1 ELSE 0 END) as total_delivered,
        SUM(CASE WHEN LOWER(status) = 'opened' THEN 1 ELSE 0 END) as total_opened,
        SUM(CASE WHEN LOWER(status) = 'clicked' THEN 1 ELSE 0 END) as total_clicked,
        SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END) as total_failed,
        SUM(CASE WHEN LOWER(status) = 'unsubscribed' THEN 1 ELSE 0 END) as total_unsubscribed,
        SUM(CASE WHEN LOWER(status) = 'complaint' THEN 1 ELSE 0 END) as total_complaint
       FROM email_logs${dateFilterSql}`,
      filterParams
    );

    const internalAnalytics = {
      sent: Number(counts?.total_sent || 0),
      delivered: Number(counts?.total_delivered || 0),
      opened: Number(counts?.total_opened || 0),
      clicked: Number(counts?.total_clicked || 0),
      failed: Number(counts?.total_failed || 0),
      unsubscribed: Number(counts?.total_unsubscribed || 0),
      complaints: Number(counts?.total_complaint || 0)
    };

    return {
      success: true,
      provider: 'MSG91',
      startDate: startDate || null,
      endDate: endDate || null,
      analytics: msg91Data || internalAnalytics,
      internalAnalytics,
      providerError
    };
  }

  // --- NEW API: INTERNAL CRM EMAIL LOGS & JOURNEY (PART 18 & 19) ---
  async getLogs(params = {}) {
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const limit = Math.max(1, Math.min(100, parseInt(params.limit || 20, 10)));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const queryParams = [];

    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      whereClauses.push('(l.recipient_email LIKE ? OR l.recipient_name LIKE ? OR l.subject LIKE ? OR l.crqid LIKE ?)');
      queryParams.push(term, term, term, term);
    }

    if (params.status && params.status !== 'all') {
      whereClauses.push('LOWER(l.status) = LOWER(?)');
      queryParams.push(params.status.trim());
    }

    if (params.startDate && params.endDate) {
      whereClauses.push('l.created_at >= ? AND l.created_at <= ?');
      queryParams.push(`${params.startDate} 00:00:00`, `${params.endDate} 23:59:59`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM email_logs l ${whereSql}`,
      queryParams
    );

    const [items] = await db.query(
      `SELECT l.*, t.name as template_name, s.name as sent_by_name
       FROM email_logs l
       LEFT JOIN email_templates t ON l.template_id = t.id
       LEFT JOIN staff s ON l.sent_by = s.id
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async getLogJourney(logId) {
    const numericId = parseInt(logId, 10);
    if (!numericId) {
      const err = new Error('Invalid email log ID');
      err.statusCode = 400;
      throw err;
    }

    const [[log]] = await db.query(
      `SELECT l.*, t.name as template_name, s.name as sent_by_name
       FROM email_logs l
       LEFT JOIN email_templates t ON l.template_id = t.id
       LEFT JOIN staff s ON l.sent_by = s.id
       WHERE l.id = ?`,
      [numericId]
    );

    if (!log) {
      const err = new Error(`Email Log #${numericId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const [events] = await db.query(
      `SELECT * FROM email_events WHERE email_log_id = ? OR (crqid IS NOT NULL AND crqid = ?) ORDER BY event_timestamp ASC, id ASC`,
      [numericId, log.crqid]
    );

    return {
      success: true,
      log,
      timeline: events
    };
  }

  // --- NEW API: RECONCILE MSG91 LOGS API (PART 20 & 21) ---
  async reconcileMsg91Logs(fromDate, toDate) {
    let msg91Logs = [];
    try {
      msg91Logs = await msg91Provider.getEmailLogsFromMsg91({ fromDate, toDate });
    } catch (err) {
      console.error('[MailService] Reconciliation fetch error:', err.message);
      throw err;
    }

    let reconciledCount = 0;
    const logItems = Array.isArray(msg91Logs) ? msg91Logs : (msg91Logs.logs || []);

    for (const item of logItems) {
      const crqid = item.crqid || item.crqId || null;
      const recipient = item.email || item.recipient || item.to || null;
      const status = item.status || item.event || null;

      if (!status) continue;

      let [[log]] = crqid ? await db.query('SELECT * FROM email_logs WHERE crqid = ?', [crqid]) : [[]];
      if (!log && recipient) {
        [[log]] = await db.query('SELECT * FROM email_logs WHERE LOWER(recipient_email) = LOWER(?) ORDER BY id DESC LIMIT 1', [recipient.trim()]);
      }

      if (log) {
        const normalized = status.toUpperCase();
        if (log.status !== normalized) {
          await db.query('UPDATE email_logs SET status = ?, last_event = ?, last_event_at = NOW() WHERE id = ?', [normalized, normalized, log.id]);
          await db.query(
            `INSERT INTO email_events (email_log_id, provider, event_name, event_status, event_timestamp, recipient, crqid, raw_payload)
             VALUES (?, 'MSG91', ?, ?, NOW(), ?, ?, ?)`,
            [log.id, normalized, normalized, recipient, log.crqid, JSON.stringify(item)]
          );
          reconciledCount++;
        }
      }
    }

    return {
      success: true,
      reconciledCount,
      totalLogsFetched: logItems.length
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
