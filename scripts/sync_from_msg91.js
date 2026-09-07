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

async function syncFromMsg91MasterDetailed() {
  try {
    console.log('====================================================');
    console.log('       MSG91 TEMPLATE MASTER SYNC STARTING          ');
    console.log('====================================================\n');

    // Test DB connection and log status
    const [dbTest] = await db.query('SELECT DATABASE() as dbname, @@hostname as host');
    console.log(`[DB CONNECTED] Successfully connected to MySQL Database: "${dbTest[0]?.dbname || 'CRM Database'}"\n`);

    console.log('[MSG91 FETCH] Fetching all templates & first version (t.versions[0]) from MSG91 API...');
    const liveTemplates = await msg91Provider.listTemplatesInMsg91({ per_page: 100 });
    console.log(`[MSG91 FETCHED] Successfully retrieved ${liveTemplates.length} live templates from MSG91.\n`);

    let updatedCount = 0;
    let insertedCount = 0;
    let index = 0;

    for (const t of liveTemplates) {
      index++;
      const slug = t.slug || String(t.id);
      const name = (t.name || t.slug || `MSG91 Template ${t.id}`).trim();

      // REQUIREMENT: Always take the first version (v1.0 / t.versions[0])
      let targetVer = null;
      if (Array.isArray(t.versions) && t.versions.length > 0) {
        targetVer = t.versions[0]; // First version for all
      } else {
        targetVer = t;
      }

      const subject = (targetVer?.subject || t.subject || `Template: ${name}`).trim();
      const rawBody = targetVer?.body || t.body || '';
      const newBodyHtml = cleanHtml(rawBody);
      const statusId = targetVer?.status_id !== undefined ? Number(targetVer.status_id) : (t.status_id ?? 2);
      const mappedStatus = msg91Provider.getTemplateStatus(statusId);
      const versionId = targetVer?.id ? String(targetVer.id) : null;

      if (!newBodyHtml) {
        console.log(`[ITEM ${index}/${liveTemplates.length}] [SKIP] Template "${name}" (slug: ${slug}) - no body HTML content in first version.`);
        continue;
      }

      const normName = normalizeName(name);

      // Check existing template in database
      const [existing] = await db.query(
        `SELECT id, name, subject, body_html, msg91_slug FROM email_templates 
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
        const prevBodySample = (existing[0].body_html || '').replace(/\s+/g, ' ').substring(0, 90);
        const newBodySample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 90);

        await db.query(
          `UPDATE email_templates 
           SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, updated_at = NOW() 
           WHERE id = ?`,
          [name, subject, newBodyHtml, mappedStatus, slug, slug, crmId]
        );

        console.log(`[ITEM ${index}/${liveTemplates.length}] [DB UPDATED] CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
        console.log(`  ├─ PREVIOUS CONTENT IN DB : "${prevBodySample}..."`);
        console.log(`  └─ NEW MSG91 CONTENT      : "${newBodySample}..."`);
        updatedCount++;
      } else {
        // Check fuzzy match
        const [fuzzyMatch] = await db.query(
          `SELECT id, name, body_html FROM email_templates WHERE (msg91_slug IS NULL OR msg91_slug = '') AND LOWER(name) LIKE ?`,
          [`%${normName.split(' ')[0]}%`]
        );

        if (fuzzyMatch.length > 0) {
          crmId = fuzzyMatch[0].id;
          const prevBodySample = (fuzzyMatch[0].body_html || '').replace(/\s+/g, ' ').substring(0, 90);
          const newBodySample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 90);

          await db.query(
            `UPDATE email_templates 
             SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, updated_at = NOW() 
             WHERE id = ?`,
            [name, subject, newBodyHtml, mappedStatus, slug, slug, crmId]
          );

          console.log(`[ITEM ${index}/${liveTemplates.length}] [DB UPDATED FUZZY] CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
          console.log(`  ├─ PREVIOUS CONTENT IN DB : "${prevBodySample}..."`);
          console.log(`  └─ NEW MSG91 CONTENT      : "${newBodySample}..."`);
          updatedCount++;
        } else {
          const newBodySample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 90);
          const [ins] = await db.query(
            `INSERT INTO email_templates (name, slug, subject, body_html, status, is_uploaded, msg91_slug, msg91_template_id) 
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
            [name, slug, subject, newBodyHtml, mappedStatus, slug, slug]
          );
          crmId = ins.insertId;

          console.log(`[ITEM ${index}/${liveTemplates.length}] [DB INSERTED] New CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
          console.log(`  ├─ PREVIOUS CONTENT IN DB : (None - New Record Created)`);
          console.log(`  └─ NEW MSG91 CONTENT      : "${newBodySample}..."`);
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

    console.log(`\n====================================================`);
    console.log(`  SYNC COMPLETE! Updated: ${updatedCount} | Inserted: ${insertedCount}`);
    console.log(`====================================================\n`);
    process.exit(0);
  } catch (e) {
    console.error('Error during MSG91 master detailed sync:', e);
    process.exit(1);
  }
}

syncFromMsg91MasterDetailed();
