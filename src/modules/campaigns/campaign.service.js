const db = require('../../config/db');
const auditService = require('../audit/audit.service');

class CampaignService {
  /**
   * Create a new campaign draft
   */
  async createCampaign(payload, creatorId) {
    const { name, subject, templateId, bodyHtml, sendConfig } = payload;
    if (!name || !subject) {
      const err = new Error('Campaign name and subject are required');
      err.statusCode = 400;
      throw err;
    }

    let finalBody = bodyHtml || '';
    if (!finalBody && templateId) {
      const [[tpl]] = await db.query('SELECT body_html FROM email_templates WHERE id = ?', [templateId]);
      if (tpl) finalBody = tpl.body_html;
    }

    const configJson = sendConfig ? JSON.stringify(sendConfig) : null;

    const [result] = await db.query(
      `INSERT INTO email_campaigns (name, subject, template_id, status, send_config, created_by)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
      [name, subject, templateId || null, configJson, creatorId]
    );

    const campaignId = result.insertId;

    await auditService.log({
      actorId: creatorId,
      actorRole: 'admin',
      action: 'CAMPAIGN_CREATE',
      entityType: 'campaign',
      entityId: campaignId,
      meta: { name, subject }
    });

    return this.getCampaignById(campaignId);
  }

  /**
   * Get campaign by ID with aggregated stats
   */
  async getCampaignById(id) {
    const [[campaign]] = await db.query('SELECT * FROM email_campaigns WHERE id = ?', [id]);
    if (!campaign) {
      const err = new Error('Campaign not found');
      err.statusCode = 404;
      throw err;
    }

    // Fetch recipient counts by status
    const [counts] = await db.query(
      `SELECT status, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY status`,
      [id]
    );

    const stats = {
      total: 0,
      pending: 0,
      sent: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      bounced: 0,
      unsubscribed: 0,
      failed: 0
    };

    for (const row of counts) {
      stats[row.status] = row.count;
      stats.total += row.count;
    }

    return {
      ...campaign,
      stats
    };
  }

  /**
   * List campaigns with pagination
   */
  async getCampaigns(page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT c.*, s.name as created_by_name,
        (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id) as recipient_count
       FROM email_campaigns c
       LEFT JOIN staff s ON c.created_by = s.id
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM email_campaigns');

    return {
      items: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Add recipients to a campaign draft
   */
  async addRecipients(campaignId, payload) {
    const campaign = await this.getCampaignById(campaignId);
    if (campaign.status !== 'draft') {
      const err = new Error('Recipients can only be modified while the campaign is in draft status');
      err.statusCode = 400;
      throw err;
    }

    const { contactIds, customEmails } = payload;
    let addedCount = 0;

    if (Array.isArray(contactIds) && contactIds.length > 0) {
      const [contacts] = await db.query(
        `SELECT id, email, is_opted_out, email_invalid FROM users WHERE id IN (?) AND email IS NOT NULL AND email != ''`,
        [contactIds]
      );

      for (const c of contacts) {
        // Exclude opted out or invalid emails
        if (c.is_opted_out || c.email_invalid) continue;

        try {
          await db.query(
            `INSERT INTO campaign_recipients (campaign_id, contact_id, email_address, status)
             VALUES (?, ?, ?, 'pending')
             ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            [campaignId, c.id, c.email.trim()]
          );
          addedCount++;
        } catch {}
      }
    }

    if (Array.isArray(customEmails) && customEmails.length > 0) {
      for (const entry of customEmails) {
        const email = typeof entry === 'string' ? entry.trim() : entry.email;
        if (!email) continue;

        try {
          await db.query(
            `INSERT INTO campaign_recipients (campaign_id, contact_id, email_address, status)
             VALUES (?, NULL, ?, 'pending')
             ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            [campaignId, email]
          );
          addedCount++;
        } catch {}
      }
    }

    return { addedCount, totalRecipients: (await this.getCampaignById(campaignId)).stats.total };
  }

  /**
   * Remove a recipient from a draft campaign
   */
  async removeRecipient(campaignId, contactId) {
    const campaign = await this.getCampaignById(campaignId);
    if (campaign.status !== 'draft') {
      const err = new Error('Recipients can only be modified while campaign is in draft status');
      err.statusCode = 400;
      throw err;
    }

    await db.query(
      'DELETE FROM campaign_recipients WHERE campaign_id = ? AND contact_id = ?',
      [campaignId, contactId]
    );

    return { success: true };
  }

  /**
   * Dispatch / Send campaign via Nodemailer & BullMQ Queue
   */
  async sendCampaign(campaignId, senderId) {
    const campaign = await this.getCampaignById(campaignId);
    if (campaign.status === 'sending' || campaign.status === 'sent') {
      const err = new Error(`Campaign has already been ${campaign.status}`);
      err.statusCode = 400;
      throw err;
    }

    // Get all pending recipients
    const [recipients] = await db.query(
      `SELECT cr.*, u.name as contact_name, u.email as contact_email
       FROM campaign_recipients cr
       LEFT JOIN users u ON cr.contact_id = u.id
       WHERE cr.campaign_id = ? AND cr.status = 'pending'`,
      [campaignId]
    );

    if (recipients.length === 0) {
      const err = new Error('No valid pending recipients found for this campaign');
      err.statusCode = 400;
      throw err;
    }

    // Fetch template body if needed
    let bodyHtml = campaign.body_html || '';
    if (!bodyHtml && campaign.template_id) {
      const [[tpl]] = await db.query('SELECT body_html FROM email_templates WHERE id = ?', [campaign.template_id]);
      if (tpl) bodyHtml = tpl.body_html;
    }

    // Update status to sending
    await db.query(`UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = ?`, [campaignId]);

    try {
      const { emailQueue } = require('../../queues/email.queue');

      for (const r of recipients) {
        const recipientEmail = r.email_address || r.contact_email;
        const recipientObj = {
          email: recipientEmail,
          name: r.contact_name || '',
          user_id: r.contact_id || null,
          customerObj: {
            name: r.contact_name || '',
            email: recipientEmail,
            id: r.contact_id || null
          }
        };

        await emailQueue.add('sendEmail', {
          campaignId,
          recipient: recipientObj,
          subject: campaign.subject,
          bodyHtml,
          templateId: campaign.template_id || null,
          senderId
        });
      }

      await db.query(
        `UPDATE email_campaigns SET status = 'sent', updated_at = NOW() WHERE id = ?`,
        [campaignId]
      );

      await auditService.log({
        actorId: senderId,
        actorRole: 'admin',
        action: 'CAMPAIGN_SENT',
        entityType: 'campaign',
        entityId: campaignId,
        meta: { recipientCount: recipients.length }
      });

      return {
        success: true,
        campaignId,
        recipientCount: recipients.length
      };
    } catch (err) {
      await db.query(`UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = ?`, [campaignId]);
      throw err;
    }
  }

  /**
   * Schedule campaign for future dispatch
   */
  async scheduleCampaign(campaignId, sendTime, senderId) {
    if (!sendTime) {
      const err = new Error('Scheduled sendTime is required (e.g., MM/DD/YYYY HH:MM -XX:XX)');
      err.statusCode = 400;
      throw err;
    }

    const campaign = await this.getCampaignById(campaignId);
    let sendConfig = campaign.send_config ? (typeof campaign.send_config === 'string' ? JSON.parse(campaign.send_config) : campaign.send_config) : {};
    sendConfig.sendTime = sendTime;

    await db.query(
      `UPDATE email_campaigns SET status = 'scheduled', scheduled_at = ?, send_config = ?, updated_at = NOW() WHERE id = ?`,
      [new Date(sendTime), JSON.stringify(sendConfig), campaignId]
    );

    return this.sendCampaign(campaignId, senderId);
  }

  /**
   * Get detailed analytics for a campaign
   */
  async getAnalytics(campaignId) {
    const campaign = await this.getCampaignById(campaignId);

    const [events] = await db.query(
      `SELECT event_type, COUNT(*) as count
       FROM email_events
       WHERE campaign_id = ?
       GROUP BY event_type`,
      [campaignId]
    );

    const [recentEvents] = await db.query(
      `SELECT id, recipient_email, event_type, event_source, event_at
       FROM email_events
       WHERE campaign_id = ?
       ORDER BY event_at DESC LIMIT 50`,
      [campaignId]
    );

    return {
      campaignId,
      name: campaign.name,
      status: campaign.status,
      stats: campaign.stats,
      eventSummary: events,
      recentEvents
    };
  }

  /**
   * Get global email tracking KPIs, lead conversions, and real-time event feed
   */
  async getGlobalTrackingSummary() {
    const [[campaignRecipientStats]] = await db.query(`
      SELECT 
        COUNT(*) as total_recipients,
        SUM(CASE WHEN status IN ('sent', 'opened', 'clicked', 'replied') THEN 1 ELSE 0 END) as total_sent
      FROM campaign_recipients
    `);

    const [[logStats]] = await db.query(`
      SELECT COUNT(*) as sent_logs
      FROM email_logs
      WHERE status = 'sent'
    `);

    const [[eventStats]] = await db.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN event_type = 'Open' THEN CONCAT(recipient_email, '-', COALESCE(campaign_id, 0)) END) as total_opened,
        COUNT(DISTINCT CASE WHEN event_type = 'Click' THEN CONCAT(recipient_email, '-', COALESCE(campaign_id, 0)) END) as total_clicked,
        COUNT(DISTINCT CASE WHEN event_type = 'Reply' THEN CONCAT(recipient_email, '-', COALESCE(campaign_id, 0)) END) as total_replied,
        COUNT(DISTINCT CASE WHEN event_type = 'Bounce' THEN CONCAT(recipient_email, '-', COALESCE(campaign_id, 0)) END) as total_bounced,
        COUNT(DISTINCT CASE WHEN event_type = 'Unsubscribe' THEN CONCAT(recipient_email, '-', COALESCE(campaign_id, 0)) END) as total_unsubscribed
      FROM email_events
    `);

    const [[campaignCounts]] = await db.query(`
      SELECT 
        COUNT(*) as total_campaigns,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_campaigns,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_campaigns
      FROM email_campaigns
    `);

    const [leadConversions] = await db.query(`
      SELECT lead_status, COUNT(*) as count
      FROM users
      WHERE lead_status IN ('Engaged', 'Hot Lead', 'Conversation Started', 'Invalid Email', 'Opted Out')
      GROUP BY lead_status
    `);

    const [recentEvents] = await db.query(`
      SELECT 
        e.id, e.campaign_id, e.recipient_email, e.event_type, e.event_source, e.event_at,
        c.name as campaign_name,
        u.id as contact_id, u.name as contact_name, u.lead_status
      FROM email_events e
      LEFT JOIN email_campaigns c ON e.campaign_id = c.id
      LEFT JOIN users u ON e.contact_id = u.id OR LOWER(e.recipient_email) = LOWER(u.email)
      ORDER BY e.event_at DESC LIMIT 50
    `);

    const totalSent = Number(campaignRecipientStats.total_sent || 0) + Number(logStats.sent_logs || 0);
    const totalOpened = Number(eventStats.total_opened || 0);
    const totalClicked = Number(eventStats.total_clicked || 0);
    const totalReplied = Number(eventStats.total_replied || 0);
    const totalBounced = Number(eventStats.total_bounced || 0);
    const totalUnsubscribed = Number(eventStats.total_unsubscribed || 0);

    const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : '0.0';
    const clickRate = totalSent > 0 ? ((totalClicked / totalSent) * 100).toFixed(1) : '0.0';
    const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '0.0';
    const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : '0.0';

    return {
      kpis: {
        totalCampaigns: Number(campaignCounts.total_campaigns || 0),
        sentCampaigns: Number(campaignCounts.sent_campaigns || 0),
        totalSent,
        totalOpened,
        totalClicked,
        totalReplied,
        totalBounced,
        totalUnsubscribed,
        openRate: Number(openRate),
        clickRate: Number(clickRate),
        replyRate: Number(replyRate),
        bounceRate: Number(bounceRate)
      },
      leadConversions,
      recentEvents
    };
  }
}

module.exports = new CampaignService();
