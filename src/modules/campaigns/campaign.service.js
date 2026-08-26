const db = require('../../config/db');
const gmassProvider = require('../../integrations/email/gmass/gmass.provider');
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
   * Dispatch / Send campaign via GMass
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
      `SELECT cr.*, u.name as contact_name
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
    let bodyHtml = '';
    if (campaign.template_id) {
      const [[tpl]] = await db.query('SELECT body_html FROM email_templates WHERE id = ?', [campaign.template_id]);
      if (tpl) bodyHtml = tpl.body_html;
    }

    // Update status to sending
    await db.query(`UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = ?`, [campaignId]);

    try {
      const recipientList = recipients.map(r => ({
        email: r.email_address,
        name: r.contact_name || '',
        contactId: r.contact_id
      }));

      const sendOptions = campaign.send_config ? (typeof campaign.send_config === 'string' ? JSON.parse(campaign.send_config) : campaign.send_config) : {};

      const result = await gmassProvider.sendCampaign({
        subject: campaign.subject,
        bodyHtml,
        recipients: recipientList,
        options: sendOptions
      });

      // Update campaign record with GMass Campaign ID & Draft ID
      await db.query(
        `UPDATE email_campaigns 
         SET status = 'sent', gmass_campaign_id = ?, gmass_draft_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [result.gmassCampaignId, result.gmassDraftId, campaignId]
      );

      // Update campaign recipients status to 'sent'
      await db.query(
        `UPDATE campaign_recipients SET status = 'sent', sent_at = NOW() WHERE campaign_id = ? AND status = 'pending'`,
        [campaignId]
      );

      await auditService.log({
        actorId: senderId,
        actorRole: 'admin',
        action: 'CAMPAIGN_SENT',
        entityType: 'campaign',
        entityId: campaignId,
        meta: { gmassCampaignId: result.gmassCampaignId, recipientCount: recipientList.length }
      });

      return {
        success: true,
        campaignId,
        gmassCampaignId: result.gmassCampaignId,
        recipientCount: recipientList.length
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
   * On-demand manual sync/pull for a specific campaign via GMass API
   */
  async syncCampaignFromGMass(campaignId) {
    const campaign = await this.getCampaignById(campaignId);
    const gmassCampaignId = campaign.gmass_campaign_id;
    if (!gmassCampaignId) {
      const err = new Error('Campaign does not have an associated GMass Campaign ID yet');
      err.statusCode = 400;
      throw err;
    }

    const GMassClient = require('../../integrations/email/gmass/gmass.client');
    const gmassWebhookProcessor = require('../../integrations/email/gmass/gmass.webhook');
    const client = new GMassClient();

    const reportTypes = [
      { type: 'Open', fetchFn: () => client.getOpens(gmassCampaignId) },
      { type: 'Click', fetchFn: () => client.getClicks(gmassCampaignId) },
      { type: 'Reply', fetchFn: () => client.getReplies(gmassCampaignId) },
      { type: 'Bounce', fetchFn: () => client.getBounces(gmassCampaignId) },
      { type: 'Unsubscribe', fetchFn: () => client.getUnsubscribes(gmassCampaignId) }
    ];

    let reconciledEventsCount = 0;
    for (const report of reportTypes) {
      try {
        const data = await report.fetchFn();
        const items = Array.isArray(data) ? data : (data.results || data.items || data.data || []);

        for (const rawItem of items) {
          rawItem.campaignId = rawItem.campaignId || gmassCampaignId;
          rawItem.eventType = rawItem.eventType || report.type;

          const result = await gmassWebhookProcessor.processEvent(rawItem);
          if (result.success) reconciledEventsCount++;
        }
      } catch (err) {
        console.warn(`[GMass Sync] Error fetching ${report.type} for campaign ${gmassCampaignId}:`, err.message);
      }
    }

    return {
      success: true,
      campaignId,
      gmassCampaignId,
      reconciledEventsCount,
      updatedStats: (await this.getCampaignById(campaignId)).stats
    };
  }

  /**
   * On-demand manual sync/pull for all active campaigns via GMass API
   */
  async syncAllCampaignsFromGMass() {
    const gmassReconciliationJob = require('../../jobs/gmass-reconciliation.job');
    await gmassReconciliationJob.runReconciliation();
    return {
      success: true,
      message: 'GMass API manual reconciliation finished successfully'
    };
  }

  /**
   * Get global email tracking KPIs, lead conversions, and real-time event feed
   */
  async getGlobalTrackingSummary() {
    // 1. Total Sent, Opened, Clicked, Replied across all campaign recipients
    const [[recipientStats]] = await db.query(`
      SELECT 
        COUNT(*) as total_recipients,
        SUM(CASE WHEN status IN ('sent', 'opened', 'clicked', 'replied') THEN 1 ELSE 0 END) as total_sent,
        SUM(CASE WHEN status IN ('opened', 'clicked', 'replied') OR opened_at IS NOT NULL THEN 1 ELSE 0 END) as total_opened,
        SUM(CASE WHEN status IN ('clicked', 'replied') OR clicked_at IS NOT NULL THEN 1 ELSE 0 END) as total_clicked,
        SUM(CASE WHEN status = 'replied' OR replied_at IS NOT NULL THEN 1 ELSE 0 END) as total_replied,
        SUM(CASE WHEN status = 'bounced' OR bounced_at IS NOT NULL THEN 1 ELSE 0 END) as total_bounced,
        SUM(CASE WHEN status = 'unsubscribed' OR unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as total_unsubscribed
      FROM campaign_recipients
    `);

    // 2. Count of total campaigns & draft status
    const [[campaignCounts]] = await db.query(`
      SELECT 
        COUNT(*) as total_campaigns,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_campaigns,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_campaigns
      FROM email_campaigns
    `);

    // 3. Lead status conversions (Engaged, Hot Lead, Conversation Started, Invalid Email, Opted Out)
    const [leadConversions] = await db.query(`
      SELECT lead_status, COUNT(*) as count
      FROM users
      WHERE lead_status IN ('Engaged', 'Hot Lead', 'Conversation Started', 'Invalid Email', 'Opted Out')
      GROUP BY lead_status
    `);

    // 4. Recent real-time event feed (last 50 events)
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

    const totalSent = Number(recipientStats.total_sent || 0);
    const totalOpened = Number(recipientStats.total_opened || 0);
    const totalClicked = Number(recipientStats.total_clicked || 0);
    const totalReplied = Number(recipientStats.total_replied || 0);
    const totalBounced = Number(recipientStats.total_bounced || 0);
    const totalUnsubscribed = Number(recipientStats.total_unsubscribed || 0);

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
