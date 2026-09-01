require('dotenv').config({ path: '.env' });
const db = require('./src/config/db');
const incomingEmailService = require('./src/modules/webhooks/incomingEmail.service');
const { parseMimeSource } = require('./src/utils/mimeParser.util');

async function runFullTestSuite() {
  console.log("=================================================================");
  console.log("=== EXECUTING MSG91 INCOMING EMAIL FULL PARSER & TEST SUITE ===");
  console.log("=================================================================\n");

  const testSenderEmail = `customer_${Date.now()}@example.com`;
  let testContactId = null;

  try {
    // 1. Create Test Contact
    const [cRes] = await db.query(
      `INSERT INTO users (name, email, email_normalized, status, created_at) VALUES ('Customer Test', ?, ?, 'active', NOW())`,
      [testSenderEmail, testSenderEmail.toLowerCase()]
    );
    testContactId = cRes.insertId;
    console.log(`[SETUP] Created test contact ID=${testContactId} email=${testSenderEmail}`);

    // TEST 1: Raw MIME RFC822 Source Parsing (mailparser)
    console.log("\n--- TEST 1: Raw MIME RFC822 Source Parsing ---");
    const rawMimeSource = `From: "Customer Test" <${testSenderEmail}>
To: "RESOL CRM" <hello@weprixe.in>
Cc: "Support" <support@weprixe.in>
Subject: Re: Full MIME Test Inquiry
Message-ID: <mime-msg-123@mail.gmail.com>
In-Reply-To: <crm-log-original-123@weprixe.in>
References: <crm-log-original-123@weprixe.in>
Date: Tue, 01 Sep 2026 12:30:00 +0530
Content-Type: multipart/alternative; boundary="boundary-test-123"

--boundary-test-123
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hi Team, I am replying to check on my journal submission status.=0A=0AThanks!

--boundary-test-123
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

<p>Hi Team, I am replying to check on my journal submission status.</p><p><script>alert('XSS')</script><b>Thanks!</b></p>
--boundary-test-123--`;

    const parsedMime = await parseMimeSource(rawMimeSource);
    console.log("[TEST 1] Mime Parser Result:", {
      from: parsedMime.from,
      to: parsedMime.to,
      cc: parsedMime.cc,
      subject: parsedMime.subject,
      textBody: parsedMime.textBody,
      htmlBody: parsedMime.htmlBody,
      messageId: parsedMime.messageId,
      inReplyTo: parsedMime.inReplyTo
    });

    if (!parsedMime || !parsedMime.textBody.includes('journal submission status')) {
      throw new Error("TEST 1 FAILED: MIME source textBody was not extracted properly");
    }
    console.log("✅ [TEST 1 PASSED] Raw RFC822 MIME parsed successfully!");


    // TEST 2: Process Webhook with Raw MIME Payload
    console.log("\n--- TEST 2: Process Webhook Payload with Raw MIME Content ---");
    const webhookPayload1 = {
      id: `msg91_raw_test_${Date.now()}`,
      raw: rawMimeSource
    };

    const res1 = await incomingEmailService.processIncomingReply(webhookPayload1);
    console.log("[TEST 2] Webhook Processing Result:", res1);

    if (!res1.success || res1.contactId !== testContactId) {
      throw new Error("TEST 2 FAILED: Incoming reply was not stored or matched to contactId");
    }

    const [[dbMsg1]] = await db.query('SELECT * FROM email_messages WHERE id = ?', [res1.emailMessageId]);
    console.log("[TEST 2] Stored Database Record:", {
      id: dbMsg1.id,
      conversation_id: dbMsg1.conversation_id,
      contact_id: dbMsg1.contact_id,
      direction: dbMsg1.direction,
      from_email: dbMsg1.from_email,
      to_email: dbMsg1.to_email,
      cc: dbMsg1.cc,
      subject: dbMsg1.subject,
      body_text: dbMsg1.body_text,
      body_html: dbMsg1.body_html
    });

    if (!dbMsg1.body_text.includes('journal submission status')) {
      throw new Error("TEST 2 FAILED: Database body_text does not contain actual customer message");
    }
    console.log("✅ [TEST 2 PASSED] Actual customer email body stored and threaded!");


    // TEST 3: Process MSG91 JSON Payload (User's Exact Structure)
    console.log("\n--- TEST 3: Process MSG91 JSON Payload ---");
    const webhookPayload3 = {
      id: `10638241_${Date.now()}`,
      companyId: "565195",
      to: JSON.stringify({ display: "RESOL CRM", address: "hello@weprixe.in", is_group: false }),
      from: JSON.stringify({ display: "Customer Test", address: testSenderEmail, is_group: false }),
      receiver: "hello@weprixe.in",
      subject: "Re: Welcome Test 3 to Resol Global",
      inReplyTo: "<crm-log-original-123@weprixe.in>",
      messageId: `<msg-${Date.now()}@mail.gmail.com>`,
      text: "Hi, I would like to know more about the journal.",
      raw: "inbounds/2026-09-01/raw-mail-178824597816.txt",
      createdAt: new Date().toISOString()
    };

    const res3 = await incomingEmailService.processIncomingReply(webhookPayload3);
    console.log("[TEST 3] MSG91 JSON Payload Result:", res3);

    if (!res3.success || res3.contactId !== testContactId) {
      throw new Error("TEST 3 FAILED: MSG91 JSON payload failed to match contact or process");
    }
    console.log("✅ [TEST 3 PASSED] MSG91 JSON payload normalized and stored!");


    // TEST 4: Webhook Idempotency Check
    console.log("\n--- TEST 4: Webhook Idempotency Check ---");
    const res4 = await incomingEmailService.processIncomingReply(webhookPayload3);
    console.log("[TEST 4] Idempotency Check Result:", res4);

    if (!res4.duplicate) {
      throw new Error("TEST 4 FAILED: Duplicate webhook was not caught by idempotency check");
    }
    console.log("✅ [TEST 4 PASSED] Duplicate MSG91 webhook retries handled gracefully!");


    console.log("\n=================================================================");
    console.log("🎉 ALL PARSER & WEBHOOK TESTS PASSED 100%!");
    console.log("=================================================================");

  } catch (err) {
    console.error("\n❌ TEST SUITE FAILED:", err.message, err.stack);
  } finally {
    if (testContactId) {
      await db.query('DELETE FROM email_messages WHERE contact_id = ?', [testContactId]);
      await db.query('DELETE FROM email_conversations WHERE contact_id = ?', [testContactId]);
      await db.query('DELETE FROM users WHERE id = ?', [testContactId]);
    }
    process.exit(0);
  }
}

runFullTestSuite();
