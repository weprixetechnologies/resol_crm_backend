require('dotenv').config({ path: '.env' });
const db = require('../src/config/db');
const { msg91Provider } = require('../src/integrations/email');

const cleanHtml = (rawHtml) => {
  if (!rawHtml) return '';
  let str = String(rawHtml).trim();
  if (str.startsWith('```')) {
    str = str.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return str;
};

const normalizeName = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
};

async function syncFromMsg91Master() {
  try {
    console.log('Fetching live templates from MSG91 API...');
    const liveTemplates = await msg91Provider.listTemplatesInMsg91({ per_page: 100 });
    console.log(`Found ${liveTemplates.length} live templates on MSG91.\n`);

    let updatedCount = 0;
    let insertedCount = 0;

    for (const t of liveTemplates) {
      const slug = t.slug || String(t.id);
      const name = (t.name || t.slug || `MSG91 Template ${t.id}`).trim();

      // Find active or best version
      let targetVer = null;
      if (Array.isArray(t.versions) && t.versions.length > 0) {
        // Priority 1: active version with body
        targetVer = t.versions.find(v => (v.is_active === true || v.is_active === 1 || v.is_active === '1') && v.body);
        // Priority 2: approved status_id (2 or 5) with body
        if (!targetVer) {
          targetVer = t.versions.find(v => (v.status_id === 2 || v.status_id === 5) && v.body);
        }
        // Priority 3: any version with body
        if (!targetVer) {
          targetVer = t.versions.find(v => v.body) || t.versions[0];
        }
      } else {
        targetVer = t;
      }

      const subject = (targetVer?.subject || t.subject || `Template: ${name}`).trim();
      const rawBody = targetVer?.body || t.body || '';
      const bodyHtml = cleanHtml(rawBody);
      const statusId = targetVer?.status_id !== undefined ? Number(targetVer.status_id) : (t.status_id ?? 2);
      const mappedStatus = msg91Provider.getTemplateStatus(statusId);
      const versionId = targetVer?.id ? String(targetVer.id) : null;

      if (!bodyHtml) {
        console.log(`[SKIP] Template ${name} (${slug}) - no body HTML found.`);
        continue;
      }

      const normName = normalizeName(name);

      // Search existing CRM template by slug OR by normalized name OR dummy "Welcome Aboard!"
      const [existing] = await db.query(
        `SELECT id, name, body_html, msg91_slug FROM email_templates 
         WHERE msg91_slug = ? 
            OR msg91_template_id = ? 
            OR slug = ? 
            OR LOWER(TRIM(name)) = LOWER(TRIM(?))
            OR (LOWER(name) = 'onboard' AND ? LIKE '%welcome%')
            OR (body_html LIKE '%Welcome Aboard!%' AND LOWER(TRIM(name)) = LOWER(TRIM(?)))`,
        [slug, slug, slug, name, normName, name]
      );

      let crmId;
      if (existing.length > 0) {
        crmId = existing[0].id;
        await db.query(
          `UPDATE email_templates 
           SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, updated_at = NOW() 
           WHERE id = ?`,
          [name, subject, bodyHtml, mappedStatus, slug, slug, crmId]
        );
        console.log(`[UPDATED] Existing CRM Template #${crmId} ("${name}") updated with real MSG91 HTML & slug "${slug}"`);
        updatedCount++;
      } else {
        // Also check if there's any un-linked old template with matching normalized name
        const [fuzzyMatch] = await db.query(
          `SELECT id FROM email_templates WHERE (msg91_slug IS NULL OR msg91_slug = '') AND LOWER(name) LIKE ?`,
          [`%${normName.split(' ')[0]}%`]
        );

        if (fuzzyMatch.length > 0) {
          crmId = fuzzyMatch[0].id;
          await db.query(
            `UPDATE email_templates 
             SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, updated_at = NOW() 
             WHERE id = ?`,
            [name, subject, bodyHtml, mappedStatus, slug, slug, crmId]
          );
          console.log(`[UPDATED FUZZY] Old unlinked CRM Template #${crmId} updated to "${name}" with real MSG91 HTML & slug "${slug}"`);
          updatedCount++;
        } else {
          const [ins] = await db.query(
            `INSERT INTO email_templates (name, slug, subject, body_html, status, is_uploaded, msg91_slug, msg91_template_id) 
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
            [name, slug, subject, bodyHtml, mappedStatus, slug, slug]
          );
          crmId = ins.insertId;
          console.log(`[INSERTED] New CRM Template #${crmId} ("${name}") imported from MSG91 with slug "${slug}"`);
          insertedCount++;
        }
      }

      // Upsert integration mapping
      await db.query(
        `INSERT INTO email_template_integrations 
         (crm_template_id, provider, msg91_template_id, msg91_version_id, msg91_status_id, provider_status, last_synced_at)
         VALUES (?, 'MSG91', ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           msg91_template_id = VALUES(msg91_template_id),
           msg91_version_id = VALUES(msg91_version_id),
           msg91_status_id = VALUES(msg91_status_id),
           provider_status = VALUES(provider_status),
           last_synced_at = NOW()`,
        [crmId, slug, versionId, statusId, mappedStatus]
      );
    }

    // Clean up any remaining un-linked dummy seed templates containing "Welcome Aboard!"
    const [dummyRows] = await db.query(
      `SELECT id, name FROM email_templates WHERE body_html LIKE '%Welcome Aboard!%' AND (msg91_slug IS NULL OR msg91_slug = '')`
    );
    for (const dummy of dummyRows) {
      console.log(`[CLEANUP] Deleting orphaned seed template #${dummy.id} ("${dummy.name}")`);
      await db.query('DELETE FROM email_template_integrations WHERE crm_template_id = ?', [dummy.id]);
      await db.query('DELETE FROM email_templates WHERE id = ?', [dummy.id]);
    }

    console.log(`\n========================================`);
    console.log(`Sync Complete: ${updatedCount} updated, ${insertedCount} inserted.`);
    console.log(`========================================\n`);
    process.exit(0);
  } catch (e) {
    console.error('Error during MSG91 master sync:', e);
    process.exit(1);
  }
}

syncFromMsg91Master();
