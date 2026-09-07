require('dotenv').config({ path: '.env' });
const db = require('../src/config/db');

function cleanHtmlContent(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  if (str.startsWith('```')) {
    str = str.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return str;
}

async function cleanAllTemplates() {
  try {
    const [rows] = await db.query('SELECT id, name, body_html FROM email_templates');
    console.log(`Checking ${rows.length} templates for markdown codeblock wrappers...`);

    let count = 0;
    for (const r of rows) {
      const cleaned = cleanHtmlContent(r.body_html);
      if (cleaned !== r.body_html) {
        console.log(`[CLEANED] Template #${r.id} (${r.name})`);
        await db.query('UPDATE email_templates SET body_html = ? WHERE id = ?', [cleaned, r.id]);
        count++;
      }
    }

    console.log(`Cleanup complete! Cleaned ${count} templates.`);
    process.exit(0);
  } catch (e) {
    console.error('Error during template cleanup:', e);
    process.exit(1);
  }
}

cleanAllTemplates();
