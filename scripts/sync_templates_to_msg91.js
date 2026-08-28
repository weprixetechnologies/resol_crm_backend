/**
 * Script to sync all CRM Email Templates to MSG91 via POST /api/v5/email/templates
 * Usage: node backend/scripts/sync_templates_to_msg91.js
 */

const db = require('../src/config/db');
const msg91Provider = require('../src/integrations/email/msg91.provider');

async function syncTemplates() {
  console.log('--- STARTING MSG91 EMAIL TEMPLATE SYNC ---');

  try {
    const [templates] = await db.query('SELECT * FROM email_templates ORDER BY id ASC');

    if (templates.length === 0) {
      console.log('No email templates found in database.');
      process.exit(0);
    }

    console.log(`Found ${templates.length} templates to sync with MSG91...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const t of templates) {
      console.log(`[Syncing Template #${t.id}] "${t.name}"...`);

      try {
        const result = await msg91Provider.createTemplateInMsg91({
          id: t.id,
          name: t.name,
          subject: t.subject,
          body_html: t.body_html,
          slug: t.msg91_slug || null
        });

        await db.query(
          'UPDATE email_templates SET msg91_template_id = ?, msg91_slug = ? WHERE id = ?',
          [result.msg91_template_id, result.msg91_slug, t.id]
        );

        console.log(`  ✓ Synced successfully! MSG91 Template ID/Slug: "${result.msg91_slug}"`);
        successCount++;
      } catch (err) {
        console.error(`  ⨯ Failed to sync template #${t.id}:`, err.message);
        failCount++;
      }
    }

    console.log(`\n--- SYNC COMPLETE ---`);
    console.log(`Successfully Synced: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    process.exit(0);
  } catch (err) {
    console.error('Fatal sync error:', err);
    process.exit(1);
  }
}

syncTemplates();
