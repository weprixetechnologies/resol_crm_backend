const jaroWinkler = require('jaro-winkler');
const db = require('../../config/db');

const normalizeEmail = (email) => {
  return email ? email.trim().toLowerCase() : null;
};

const normalizeMobile = (mobile) => {
  if (!mobile) return null;
  // Strip all non-digit characters
  let digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  return digits.length === 10 ? digits : null;
};

class DuplicateUtil {
  async checkDuplicate(payload, allowFuzzy = false) {
    const emailNorm = normalizeEmail(payload.email);
    const mobileNorm = normalizeMobile(payload.mobile);

    if (!emailNorm && !mobileNorm) {
      const error = new Error('At least one of email or mobile is required');
      error.code = 'VALIDATION_ERROR';
      error.statusCode = 400;
      throw error;
    }

    // Tier 1 — hard match
    let existing = null;
    if (emailNorm) {
      const [rows] = await db.query('SELECT * FROM users WHERE email_normalized = ? LIMIT 1', [emailNorm]);
      if (rows.length > 0) existing = rows[0];
    }
    
    if (!existing && mobileNorm) {
      const [rows] = await db.query('SELECT * FROM users WHERE mobile_normalized = ? LIMIT 1', [mobileNorm]);
      if (rows.length > 0) existing = rows[0];
    }

    if (existing) {
      return { isDuplicate: true, user: existing, possibleMatch: false };
    }

    // Tier 2 — fuzzy match removed as per request
    return { isDuplicate: false, possibleMatch: false };
  }
}

module.exports = {
  normalizeEmail,
  normalizeMobile,
  DuplicateUtil: new DuplicateUtil()
};
