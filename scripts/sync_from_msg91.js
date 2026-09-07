require('dotenv').config({ path: '.env' });
const db = require('../src/config/db');
const { msg91Provider } = require('../src/integrations/email');

async function syncFromMsg91() {
  try {
    const liveTemplates = await msg91Provider.listTemplatesInMsg91();
    console.log(`Found ${liveTemplates.length} live templates in MSG91...`);

    let updatedCount = 0;
    let insertedCount = 0;

    for (const t of liveTemplates) {
      const slug = t.slug || String(t.id);
      const name = t.name || t.slug || (`MSG91 Template ${t.id}`);

      // Find best active version or version with body content
      let targetVer = null;
      if (Array.isArray(t.versions) && t.versions.length > 0) {
        targetVer = t.versions.find(v => v.is_active === true || v.is_active === 1 || v.is_active === '1') || t.versions[0];
      } else {
        targetVer = t;
      }

      const subject = targetVer?.subject || t.subject || (`Template: ${name}`);
      const bodyHtml = targetVer?.body || t.body || '';
      const statusId = targetVer?.status_id !== undefined ? Number(targetVer.status_id) : (t.status_id ?? 2);
      const mappedStatus = msg91Provider.getTemplateStatus(statusId);
      const versionId = targetVer?.id ? String(targetVer.id) : null;

      if (!bodyHtml) {
        console.log(`Skipping ${slug} (no body HTML)`);
        continue;
      }

      // Check if template exists in email_templates table
      const [existing] = await db.query(
        'SELECT id, body_html FROM email_templates WHERE msg91_slug = ? OR msg91_template_id = ? OR slug = ? OR name = ?',
        [slug, slug, slug, name]
      );

      let crmId;
      if (existing.length > 0) {
        crmId = existing[0].id;
        await db.query(
          'UPDATE email_templates SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, updated_at = NOW() WHERE id = ?',
          [name, subject, bodyHtml, mappedStatus, slug, slug, crmId]
        );
        console.log(`[UPDATE] CRM Template #${crmId} (${name}) updated with real MSG91 body HTML!`);
        updatedCount++;
      } else {
        const [ins] = await db.query(
          'INSERT INTO email_templates (name, slug, subject, body_html, status, is_uploaded, msg91_slug, msg91_template_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
          [name, slug, subject, bodyHtml, mappedStatus, slug, slug]
        );
        crmId = ins.insertId;
        console.log(`[INSERT] New CRM Template #${crmId} (${name}) imported from MSG91!`);
        insertedCount++;
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

    console.log(`\nSync Summary: ${updatedCount} updated, ${insertedCount} inserted. Total MSG91 templates processed: ${liveTemplates.length}`);
    process.exit(0);
  } catch (e) {
    console.error('Error during MSG91 sync:', e);
    process.exit(1);
  }
}

syncFromMsg91();
