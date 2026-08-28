const db = require('../src/config/db');
const webhookService = require('../src/modules/webhooks/webhook.service');

async function runTests() {
  console.log('--- STARTING MSG91 EMAIL WEBHOOK AUTOMATED TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAILED: ${message}`);
      failed++;
    }
  }

  try {
    // 0. Seed test contact & email log
    const testEmail = `test_webhook_${Date.now()}@example.com`;
    const [userRes] = await db.query(
      `INSERT INTO users (name, email, lead_status, source) VALUES (?, ?, 'unverified', 'manual')`,
      ['Webhook Test User', testEmail]
    );
    const userId = userRes.insertId;

    const logCrqid = `CRM_LOG_${Date.now()}`;
    const [logRes] = await db.query(
      `INSERT INTO email_logs (crqid, msg_id, recipient_email, recipient_name, user_id, subject, status)
       VALUES (?, ?, ?, 'Webhook Test User', ?, 'Test Webhook Subject', 'sent')`,
      [logCrqid, `msg_${Date.now()}`, testEmail, userId]
    );
    const logId = logRes.insertId;

    // Test 1: Queued Event
    const queuedPayload = {
      requestId: `req_${Date.now()}_1`,
      eventId: `evt_1`,
      eventName: 'Queued',
      crqid: logCrqid,
      recipient: testEmail,
      msgId: `msg_${Date.now()}`,
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(queuedPayload);
    const [[log1]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    assert(log1.status === 'queued', `Log status updated to 'queued' (got: ${log1.status})`);

    // Test 2: Accepted Event
    const acceptedPayload = {
      requestId: `req_${Date.now()}_2`,
      eventId: `evt_2`,
      eventName: 'Accepted',
      crqid: logCrqid,
      recipient: testEmail,
      msgId: `msg_${Date.now()}`,
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(acceptedPayload);
    const [[log2]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    assert(log2.status === 'accepted', `Log status updated to 'accepted' (got: ${log2.status})`);

    // Test 3: Delivered Event
    const deliveredPayload = {
      requestId: `req_${Date.now()}_3`,
      eventId: `evt_3`,
      eventName: 'Delivered',
      crqid: logCrqid,
      recipient: testEmail,
      statusCode: '250',
      enhancedStatusCode: '2.0.0',
      reason: 'OK',
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(deliveredPayload);
    const [[log3]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    assert(log3.status === 'delivered' && log3.delivered_at !== null, `Log status updated to 'delivered' with delivered_at set`);

    // Test 4: Opened Event & Lead Status Upgrade
    const openedPayload = {
      requestId: `req_${Date.now()}_4`,
      eventId: `evt_4`,
      eventName: 'Opened',
      crqid: logCrqid,
      recipient: testEmail,
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(openedPayload);
    const [[log4]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    const [[user4]] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    assert(log4.status === 'opened' && log4.opened_at !== null, `Log status updated to 'opened' with opened_at set`);
    assert(user4.lead_status === 'Engaged', `User lead_status upgraded to 'Engaged' on Open (got: ${user4.lead_status})`);

    // Test 5: Clicked Event
    const clickedPayload = {
      requestId: `req_${Date.now()}_5`,
      eventId: `evt_5`,
      eventName: 'Clicked',
      crqid: logCrqid,
      recipient: testEmail,
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(clickedPayload);
    const [[log5]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    assert(log5.status === 'clicked' && log5.clicked_at !== null, `Log status updated to 'clicked' with clicked_at set`);

    // Test 6: Non-Downgrade Progression Rule
    // Send a 'Delivered' event after 'Clicked' - status should remain 'clicked'
    const lateDeliveredPayload = {
      requestId: `req_${Date.now()}_6`,
      eventId: `evt_6`,
      eventName: 'Delivered',
      crqid: logCrqid,
      recipient: testEmail,
      ts: Math.floor(Date.now() / 1000)
    };
    await webhookService.processEmailWebhook(lateDeliveredPayload);
    const [[log6]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [logId]);
    assert(log6.status === 'clicked', `Non-downgrade rule enforced: status remains 'clicked' instead of downgrading to 'delivered'`);

    // Test 7: Failed / Hard Bounce Event
    const failCrqid = `CRM_LOG_FAIL_${Date.now()}`;
    const failEmail = `fail_${Date.now()}@example.com`;
    const [failUserRes] = await db.query(`INSERT INTO users (name, email, lead_status) VALUES ('Fail User', ?, 'unverified')`, [failEmail]);
    const [failLogRes] = await db.query(
      `INSERT INTO email_logs (crqid, recipient_email, user_id, subject, status) VALUES (?, ?, ?, 'Fail Test', 'sent')`,
      [failCrqid, failEmail, failUserRes.insertId]
    );

    const failedPayload = {
      requestId: `req_${Date.now()}_7`,
      eventId: `evt_7`,
      eventName: 'Failed',
      crqid: failCrqid,
      recipient: failEmail,
      statusCode: '550',
      enhancedStatusCode: '5.1.1',
      reason: 'Mailbox does not exist',
      failureCategory: 'hard_bounce'
    };
    await webhookService.processEmailWebhook(failedPayload);
    const [[failLog]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [failLogRes.insertId]);
    const [[failUser]] = await db.query('SELECT * FROM users WHERE id = ?', [failUserRes.insertId]);
    assert(failLog.status === 'failed' && failLog.failure_category === 'hard_bounce', `Log status updated to 'failed' with failure category hard_bounce`);
    assert(failUser.email_invalid === 1 && failUser.lead_status === 'Invalid Email', `User marked email_invalid=1 and lead_status='Invalid Email' on hard bounce`);

    // Test 8: Unsubscribed Event
    const unsubCrqid = `CRM_LOG_UNSUB_${Date.now()}`;
    const unsubEmail = `unsub_${Date.now()}@example.com`;
    const [unsubUserRes] = await db.query(`INSERT INTO users (name, email, lead_status) VALUES ('Unsub User', ?, 'Engaged')`, [unsubEmail]);
    const [unsubLogRes] = await db.query(
      `INSERT INTO email_logs (crqid, recipient_email, user_id, subject, status) VALUES (?, ?, ?, 'Unsub Test', 'sent')`,
      [unsubCrqid, unsubEmail, unsubUserRes.insertId]
    );

    const unsubPayload = {
      requestId: `req_${Date.now()}_8`,
      eventId: `evt_8`,
      eventName: 'Unsubscribed',
      crqid: unsubCrqid,
      recipient: unsubEmail
    };
    await webhookService.processEmailWebhook(unsubPayload);
    const [[unsubLog]] = await db.query('SELECT * FROM email_logs WHERE id = ?', [unsubLogRes.insertId]);
    const [[unsubUser]] = await db.query('SELECT * FROM users WHERE id = ?', [unsubUserRes.insertId]);
    assert(unsubLog.status === 'unsubscribed' && unsubLog.unsubscribed_at !== null, `Log status updated to 'unsubscribed'`);
    assert(unsubUser.is_opted_out === 1 && unsubUser.lead_status === 'Opted Out', `User marked is_opted_out=1 and lead_status='Opted Out'`);

    // Test 9: Idempotency & Duplicate Replay Safety
    const dupPayload = {
      requestId: `req_dup_${Date.now()}`,
      eventId: `evt_dup`,
      eventName: 'Delivered',
      crqid: logCrqid,
      recipient: testEmail,
      msgId: `msg_dup_${Date.now()}`
    };
    const resFirst = await webhookService.processEmailWebhook(dupPayload);
    const resSecond = await webhookService.processEmailWebhook(dupPayload);
    assert(resFirst.processed === true, `First webhook call processed successfully`);
    assert(resSecond.duplicate === true, `Second duplicate webhook call recognized as DUPLICATE and ignored safely`);

    // Test 10: Unknown Event Handling
    const unknownPayload = {
      requestId: `req_unk_${Date.now()}`,
      eventId: `evt_unk`,
      eventName: 'CustomCustomEvent',
      crqid: logCrqid,
      recipient: testEmail
    };
    const resUnknown = await webhookService.processEmailWebhook(unknownPayload);
    assert(resUnknown.success === true, `Unknown event handled without crashing server`);

    // Test 11: Unmatched Event Handling
    const unmatchedPayload = {
      requestId: `req_unm_${Date.now()}`,
      eventId: `evt_unm`,
      eventName: 'Delivered',
      crqid: `CRM_LOG_9999999999`,
      recipient: `nonexistent_${Date.now()}@example.com`
    };
    const resUnmatched = await webhookService.processEmailWebhook(unmatchedPayload);
    assert(resUnmatched.unmatched === true, `Unmatched event captured safely as UNMATCHED`);

    console.log(`\n--- TEST SUMMARY ---`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('ALL MSG91 WEBHOOK TESTS PASSED SUCCESSFULLY! ✓');
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution failed with exception:', err);
    process.exit(1);
  }
}

runTests();
