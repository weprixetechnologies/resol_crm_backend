const EmailProvider = require('./email-provider.interface');
const mailService = require('../../modules/mail/mail.service');

class NodemailerProvider extends EmailProvider {
  async verifyConnection() {
    return mailService.testConnection();
  }

  async sendTransactional(options) {
    const { to, subject, html, customerObj, senderId } = options;
    const result = await mailService.sendMail({
      customEmails: [{ email: to, name: options.toName || '' }],
      subject,
      body_html: html
    }, senderId || null);

    return {
      success: true,
      provider: 'nodemailer',
      result
    };
  }

  async sendCampaign(campaign) {
    const { subject, bodyHtml, recipients, senderId } = campaign;
    const customerIds = recipients.filter(r => r.contactId).map(r => r.contactId);
    const customEmails = recipients.filter(r => !r.contactId).map(r => ({ email: r.email, name: r.name }));

    const result = await mailService.sendMail({
      customerIds,
      customEmails,
      subject,
      body_html: bodyHtml
    }, senderId || null);

    return {
      success: true,
      provider: 'nodemailer',
      result
    };
  }
}

module.exports = new NodemailerProvider();
