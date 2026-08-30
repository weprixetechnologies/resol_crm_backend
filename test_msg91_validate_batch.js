require('dotenv').config({ path: '.env' });
const db = require('./src/config/db');
const msg91Provider = require('./src/integrations/email/msg91.provider');

async function test() {
  console.log("=== TESTING MSG91 BULK EMAIL VALIDATION ===");
  try {
    const [rows] = await db.query(
      `SELECT email FROM users WHERE email IS NOT NULL AND email != '' LIMIT 10`
    );
    const emails = rows.map(r => r.email);
    console.log("Test Emails from DB:", emails);

    const res = await msg91Provider.validateEmails(emails);
    console.log("Validation Result:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Validation Error:", err.message, err);
  }
  process.exit(0);
}

test();
