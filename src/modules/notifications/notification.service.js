class NotificationService {
  /**
   * Stub for sending SMS
   * @param {string} mobile 
   * @param {string} message 
   */
  async sendSMS(mobile, message) {
    console.log(`[SMS STUB] To: ${mobile} | Message: ${message}`);
    // In production, integrate with MSG91, Twilio, etc.
    return true;
  }

  /**
   * Stub for sending Email
   * @param {string} email 
   * @param {string} subject 
   * @param {string} htmlContent 
   */
  async sendEmail(email, subject, htmlContent) {
    console.log(`[EMAIL STUB] To: ${email} | Subject: ${subject}`);
    // In production, integrate with SendGrid, Amazon SES, Nodemailer, etc.
    return true;
  }
}

module.exports = new NotificationService();
