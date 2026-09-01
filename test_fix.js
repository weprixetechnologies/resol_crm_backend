require('dotenv').config({ path: '.env' });
const db = require('./src/config/db');
const incomingEmailService = require('./src/modules/webhooks/incomingEmail.service');

async function testFix() {
  const payload = {
    from: { display: "weprixe", address: "weprixeofficial@gmail.com" },
    to: "journals@weprixe.in",
    subject: "Re: Welcome Test 3 to Resol Global",
    text: "Test reply content",
    html: "<p>Test reply content</p>",
    "message-id": "<msg-123@gmail.com>",
    "in-reply-to": "<1788110630-a2a0b1e1-9bdc-40bc-a9a5-db1ed40b96e7-2@weprixe.in>",
    provider_message_id: `test_fix_${Date.now()}`
  };

  try {
    const res = await incomingEmailService.processIncomingReply(payload);
    console.log("SUCCESS:", res);
  } catch (err) {
    console.error("FAILED:", err);
  } finally {
    process.exit(0);
  }
}

testFix();
