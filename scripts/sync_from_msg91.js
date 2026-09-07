require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
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

async function syncFromMsg91MasterDetailedWithProof() {
  try {
    const timestamp = new Date().toISOString();
    console.log('====================================================');
    console.log('   MSG91 TEMPLATE MASTER SYNC & PROOF GENERATOR    ');
    console.log('====================================================\n');

    // Test DB connection and log status
    const [dbTest] = await db.query('SELECT DATABASE() as dbname, @@hostname as host');
    const dbName = dbTest[0]?.dbname || 'CRM Database';
    console.log(`[DB CONNECTED] Successfully connected to MySQL Database: "${dbName}"\n`);

    console.log('[MSG91 FETCH] Fetching all templates & first version (t.versions[0]) from MSG91 API...');
    const liveTemplates = await msg91Provider.listTemplatesInMsg91({ per_page: 100 });
    console.log(`[MSG91 FETCHED] Successfully retrieved ${liveTemplates.length} live templates from MSG91.\n`);

    let updatedCount = 0;
    let insertedCount = 0;
    let index = 0;

    const proofEntries = [];

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
      const versionId = targetVer?.id ? String(targetVer.id) : (targetVer?.version_id ? String(targetVer.version_id) : 'v1.0');

      if (!newBodyHtml) {
        console.log(`[ITEM ${index}/${liveTemplates.length}] [SKIP] Template "${name}" (slug: ${slug}) - no body HTML content in first version.`);
        continue;
      }

      const normName = normalizeName(name);

      // Check existing template in database
      const [existing] = await db.query(
        `SELECT id, name, subject, body_html, design_json, msg91_slug FROM email_templates 
         WHERE msg91_slug = ? 
            OR msg91_template_id = ? 
            OR slug = ? 
            OR LOWER(TRIM(name)) = LOWER(TRIM(?))
            OR (LOWER(name) = 'onboard' AND ? LIKE '%welcome%')
            OR (body_html LIKE '%Welcome Aboard!%' AND LOWER(TRIM(name)) = LOWER(TRIM(?)))`,
        [slug, slug, slug, name, normName, name]
      );

      let crmId;
      let prevSubject = 'N/A (New Record)';
      let prevBodyHtml = '(None - New Record Created)';
      let actionType = 'INSERTED';
      let comparisonOutcome = '';

      if (existing.length > 0) {
        crmId = existing[0].id;
        prevSubject = existing[0].subject || '';
        prevBodyHtml = existing[0].body_html || '';
        actionType = 'UPDATED';

        // Clear stale design_json if it was dummy blocks ("Welcome Aboard!") or raw HTML template
        await db.query(
          `UPDATE email_templates 
           SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, design_json = NULL, updated_at = NOW() 
           WHERE id = ?`,
          [name, subject, newBodyHtml, mappedStatus, slug, slug, crmId]
        );

        if (prevBodyHtml.trim() === newBodyHtml.trim() && prevSubject.trim() === subject.trim()) {
          comparisonOutcome = 'IDENTICAL: Content already matches MSG91';
        } else {
          comparisonOutcome = `UPDATED: Subject (${prevSubject !== subject ? 'Changed' : 'Same'}), Body HTML updated (${prevBodyHtml.length} chars -> ${newBodyHtml.length} chars)`;
        }

        const prevSample = prevBodyHtml.replace(/\s+/g, ' ').substring(0, 80);
        const newSample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 80);

        console.log(`[ITEM ${index}/${liveTemplates.length}] [DB UPDATED] CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
        console.log(`  ├─ PREVIOUS SUBJECT IN DB : "${prevSubject}"`);
        console.log(`  ├─ NEW MSG91 SUBJECT      : "${subject}"`);
        console.log(`  ├─ PREVIOUS HTML IN DB    : "${prevSample}..."`);
        console.log(`  └─ NEW MSG91 HTML (v1.0)  : "${newSample}..."`);
        updatedCount++;
      } else {
        // Check fuzzy match
        const [fuzzyMatch] = await db.query(
          `SELECT id, name, subject, body_html FROM email_templates WHERE (msg91_slug IS NULL OR msg91_slug = '') AND LOWER(name) LIKE ?`,
          [`%${normName.split(' ')[0]}%`]
        );

        if (fuzzyMatch.length > 0) {
          crmId = fuzzyMatch[0].id;
          prevSubject = fuzzyMatch[0].subject || '';
          prevBodyHtml = fuzzyMatch[0].body_html || '';
          actionType = 'UPDATED FUZZY';

          await db.query(
            `UPDATE email_templates 
             SET name = ?, subject = ?, body_html = ?, status = ?, is_uploaded = 1, msg91_slug = ?, msg91_template_id = ?, design_json = NULL, updated_at = NOW() 
             WHERE id = ?`,
            [name, subject, newBodyHtml, mappedStatus, slug, slug, crmId]
          );

          comparisonOutcome = `UPDATED FUZZY: Matched old unlinked template #${crmId}. Body updated (${prevBodyHtml.length} chars -> ${newBodyHtml.length} chars)`;

          const prevSample = prevBodyHtml.replace(/\s+/g, ' ').substring(0, 80);
          const newSample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 80);

          console.log(`[ITEM ${index}/${liveTemplates.length}] [DB UPDATED FUZZY] CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
          console.log(`  ├─ PREVIOUS HTML IN DB    : "${prevSample}..."`);
          console.log(`  └─ NEW MSG91 HTML (v1.0)  : "${newSample}..."`);
          updatedCount++;
        } else {
          actionType = 'INSERTED';
          comparisonOutcome = `INSERTED: New template imported from MSG91 (${newBodyHtml.length} chars)`;

          const newSample = newBodyHtml.replace(/\s+/g, ' ').substring(0, 80);
          const [ins] = await db.query(
            `INSERT INTO email_templates (name, slug, subject, body_html, status, is_uploaded, msg91_slug, msg91_template_id, design_json) 
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
            [name, slug, subject, newBodyHtml, mappedStatus, slug, slug]
          );
          crmId = ins.insertId;

          console.log(`[ITEM ${index}/${liveTemplates.length}] [DB INSERTED] New CRM Template #${crmId} ("${name}") | Slug: "${slug}" | Status: ${mappedStatus}`);
          console.log(`  ├─ PREVIOUS HTML IN DB    : (None - New Record Created)`);
          console.log(`  └─ NEW MSG91 HTML (v1.0)  : "${newSample}..."`);
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

      proofEntries.push({
        crmId,
        name,
        slug,
        versionId,
        mappedStatus,
        subject,
        prevSubject,
        prevBodyHtml,
        newBodyHtml,
        actionType,
        comparisonOutcome
      });
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

    // ====================================================
    // GENERATE MARKDOWN AUDIT PROOF FILE
    // ====================================================
    let mdContent = `# MSG91 Template Sync Audit & Written Proof Log\n\n`;
    mdContent += `**Sync Execution Timestamp**: \`${timestamp}\`  \n`;
    mdContent += `**Database Host**: \`${dbName}\`  \n`;
    mdContent += `**Total Live MSG91 Templates Processed**: \`${liveTemplates.length}\` (\`Updated: ${updatedCount} | Inserted: ${insertedCount}\`)  \n\n`;

    mdContent += `## 📊 Executive Summary Table\n\n`;
    mdContent += `| CRM ID | Template Name | MSG91 Slug | Version ID | Status | Action | Comparison Outcome |\n`;
    mdContent += `|---|---|---|---|---|---|---|\n`;

    for (const p of proofEntries) {
      mdContent += `| **#${p.crmId}** | **${p.name}** | \`${p.slug}\` | \`${p.versionId}\` | **${p.mappedStatus}** | \`${p.actionType}\` | ${p.comparisonOutcome} |\n`;
    }

    mdContent += `\n---\n\n## 📝 Written Proof Log & HTML Comparisons\n\n`;

    for (const p of proofEntries) {
      mdContent += `### Template #${p.crmId}: ${p.name}\n\n`;
      mdContent += `- **MSG91 Slug**: \`${p.slug}\`  \n`;
      mdContent += `- **MSG91 Version**: \`${p.versionId}\` (First Version / v1.0)  \n`;
      mdContent += `- **Approval Status**: **${p.mappedStatus}**  \n`;
      mdContent += `- **Subject Line**: \`${p.subject}\`  \n`;
      mdContent += `- **Comparison Summary**: ${p.comparisonOutcome}  \n\n`;

      mdContent += `#### 1. Previous HTML Content in Database\n\n`;
      mdContent += `\`\`\`html\n${p.prevBodyHtml || '<!-- No previous content (New record inserted) -->'}\n\`\`\`\n\n`;

      mdContent += `#### 2. New HTML Content from MSG91 (First Version / v1.0)\n\n`;
      mdContent += `\`\`\`html\n${p.newBodyHtml}\n\`\`\`\n\n`;

      mdContent += `---\n\n`;
    }

    const proofFilePath = path.join(__dirname, 'msg91_template_sync_proof.md');
    fs.writeFileSync(proofFilePath, mdContent, 'utf8');

    console.log(`[PROOF FILE GENERATED] Written proof log saved to:\n  => ${proofFilePath}\n`);
    process.exit(0);
  } catch (e) {
    console.error('Error during MSG91 master detailed sync:', e);
    process.exit(1);
  }
}

syncFromMsg91MasterDetailedWithProof();
