/**
 * Abstract Base Class for Email Providers in the CRM.
 * Both Nodemailer (transactional) and GMass (campaigns/bulk) implement this contract.
 */
class EmailProvider {
  /**
   * Send a single transactional email
   * @param {Object} options - { to, subject, html, text, from, fromName, metadata }
   * @returns {Promise<Object>} - { success: boolean, messageId: string, provider: string, raw: any }
   */
  async sendTransactional(options) {
    throw new Error('EmailProvider.sendTransactional() must be implemented by subclass');
  }

  /**
   * Create and send a multi-recipient campaign
   * @param {Object} campaign - { name, subject, bodyHtml, recipients: [{ email, name, contactId }], options }
   * @returns {Promise<Object>} - { success: boolean, campaignId: string, draftId: string, raw: any }
   */
  async sendCampaign(campaign) {
    throw new Error('EmailProvider.sendCampaign() must be implemented by subclass');
  }

  /**
   * Verify provider credentials/connection
   * @returns {Promise<Object>} - { success: boolean, message: string }
   */
  async verifyConnection() {
    throw new Error('EmailProvider.verifyConnection() must be implemented by subclass');
  }
}

module.exports = EmailProvider;
