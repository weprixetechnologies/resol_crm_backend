const nodemailerProvider = require('./nodemailer.provider');
const msg91Provider = require('./msg91.provider');
const settingsService = require('../../modules/settings/settings.service');

async function getActiveEmailProvider(overrideProvider = null) {
  if (overrideProvider === 'msg91') return msg91Provider;
  if (overrideProvider === 'nodemailer') return nodemailerProvider;

  try {
    const settings = await settingsService.getSettings();
    if (settings.email_provider === 'msg91') {
      return msg91Provider;
    }
  } catch (err) {
    console.warn('[EmailFactory] Error fetching email_provider setting, defaulting to nodemailer:', err.message);
  }

  return nodemailerProvider;
}

module.exports = {
  nodemailerProvider,
  msg91Provider,
  getActiveEmailProvider
};
