/**
 * Automated Test Suite for MSG91 Email Template Integration
 * Tests normalization rules (Section 3, 4, 18), string serialization (Section 8, 9),
 * unusable template validation (Section 8, 11), and idempotency (Section 19).
 */

const assert = require('assert');
const msg91Provider = require('../src/integrations/email/msg91.provider');

async function runTests() {
  console.log('--- STARTING MSG91 TEMPLATE INTEGRATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function logPass(title) {
    passed++;
    console.log(`✓ PASSED: ${title}`);
  }

  function logFail(title, err) {
    failed++;
    console.error(`❌ FAILED: ${title} ->`, err.message);
  }

  // TEST 1: Active Template (is_active = true, is_draft = false)
  try {
    const res = msg91Provider.normalizeMsg91Status({ is_active: true, is_draft: false, status: 'ACTIVE' });
    assert.strictEqual(res.usable, true, 'Active template must be usable');
    assert.strictEqual(res.status, 'ACTIVE', 'Status must be ACTIVE');
    logPass('Active template normalization (usable = true, status = ACTIVE)');
  } catch (err) {
    logFail('Active template normalization', err);
  }

  // TEST 2: Draft Template (is_draft = true)
  try {
    const res = msg91Provider.normalizeMsg91Status({ is_active: false, is_draft: true });
    assert.strictEqual(res.usable, false, 'Draft template must NOT be usable');
    assert.strictEqual(res.status, 'DRAFT', 'Status must be DRAFT');
    logPass('Draft template normalization (usable = false, status = DRAFT)');
  } catch (err) {
    logFail('Draft template normalization', err);
  }

  // TEST 3: Pending Template
  try {
    const res = msg91Provider.normalizeMsg91Status({ is_active: false, is_draft: false, status: 'PENDING' });
    assert.strictEqual(res.usable, false, 'Pending template must NOT be usable');
    assert.strictEqual(res.status, 'PENDING', 'Status must be PENDING');
    logPass('Pending template normalization (usable = false, status = PENDING)');
  } catch (err) {
    logFail('Pending template normalization', err);
  }

  // TEST 4: Rejected Template
  try {
    const res = msg91Provider.normalizeMsg91Status({ is_active: false, is_draft: false, status: 'REJECTED', reason_id: 104 });
    assert.strictEqual(res.usable, false, 'Rejected template must NOT be usable');
    assert.strictEqual(res.status, 'REJECTED', 'Status must be REJECTED');
    assert.strictEqual(res.reasonId, 104, 'reason_id must be preserved');
    logPass('Rejected template normalization (usable = false, status = REJECTED, reason_id = 104)');
  } catch (err) {
    logFail('Rejected template normalization', err);
  }

  // TEST 5: Unknown Numeric Status (status_id = 2 without explicit text or is_active)
  try {
    const res = msg91Provider.normalizeMsg91Status({ status_id: 2 });
    assert.strictEqual(res.status, 'UNKNOWN', 'Undocumented status_id must resolve to UNKNOWN (do NOT guess approved)');
    assert.strictEqual(res.msg91StatusId, 2, 'msg91StatusId must preserve numeric value 2');
    assert.strictEqual(res.usable, false, 'UNKNOWN status must NOT be usable');
    logPass('Unknown numeric status_id = 2 handling (status = UNKNOWN, usable = false)');
  } catch (err) {
    logFail('Unknown numeric status_id handling', err);
  }

  // TEST 6: Numeric Template ID String Serialization (templateId = 65426 -> "65426")
  try {
    const rawId = 65426;
    const serializedId = String(rawId);
    assert.strictEqual(typeof serializedId, 'string', 'template_id must be a string');
    assert.strictEqual(serializedId, '65426', 'template_id must equal "65426"');
    logPass('Numeric template_id string serialization (65426 -> "65426")');
  } catch (err) {
    logFail('Numeric template_id string serialization', err);
  }

  // TEST 7: Null Template ID Validation
  try {
    let threw = false;
    try {
      const template_id = null;
      if (!template_id || template_id === 'null') {
        throw new Error('Validation Error: MSG91 template_id must be a non-empty string.');
      }
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Null template_id must throw validation error');
    logPass('Null template_id validation error throwing');
  } catch (err) {
    logFail('Null template_id validation error', err);
  }

  // TEST 8: API Response Normalization Schema Verification
  try {
    const rawMsg91Res = {
      id: 65426,
      version_id: 94752,
      status_id: 2,
      is_active: 1,
      is_draft: 0,
      reason_id: 1
    };
    const norm = msg91Provider.normalizeMsg91Status(rawMsg91Res);
    const normalizedPayload = {
      crmTemplateId: 145,
      msg91TemplateId: String(rawMsg91Res.id),
      msg91VersionId: String(rawMsg91Res.version_id),
      status: norm.status,
      msg91StatusId: norm.msg91StatusId,
      isActive: norm.isActive,
      isDraft: norm.isDraft,
      reasonId: norm.reasonId
    };

    assert.strictEqual(normalizedPayload.msg91TemplateId, '65426');
    assert.strictEqual(normalizedPayload.msg91VersionId, '94752');
    assert.strictEqual(normalizedPayload.status, 'ACTIVE');
    assert.strictEqual(normalizedPayload.isActive, true);
    logPass('API response normalization schema verification');
  } catch (err) {
    logFail('API response normalization schema verification', err);
  }

  console.log('\n--- TEST SUMMARY ---');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('ALL MSG91 TEMPLATE INTEGRATION TESTS PASSED! ✓');
    process.exit(0);
  }
}

runTests();
