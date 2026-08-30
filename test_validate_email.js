require('dotenv').config({ path: '.env' });
const msg91Provider = require('./src/integrations/email/msg91.provider');
const db = require('./src/config/db');

async function run() {
  console.log("=== TESTING MSG91 EMAIL VALIDATION API ===");
  try {
    const testEmails = ["ronitsarkar.dev@gmail.com", "olsgghiuh35lkn35@gmail.com"];
    console.log("Validating emails:", testEmails);
    const res = await msg91Provider.validateEmails(testEmails);
    console.log("MSG91 Validation Response:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Validation Error:", err.message, err.stack);
  }

  process.exit(0);
}

run();
