require('dotenv').config({ path: '.env' });
const db = require('./src/config/db');

async function inspectLogs() {
  const [logs] = await db.query(
    `SELECT id, crqid, msg_id, request_id, message_id_header, conversation_id, subject, recipient_email FROM email_logs ORDER BY id DESC LIMIT 10`
  );
  console.log("RECENT EMAIL LOGS:", logs);

  const [convs] = await db.query(`SELECT * FROM email_conversations ORDER BY id DESC LIMIT 10`);
  console.log("RECENT CONVERSATIONS:", convs);

  const [msgs] = await db.query(`SELECT id, conversation_id, contact_id, direction, from_email, to_email, subject, left(body_html, 50) as body_sample FROM email_messages ORDER BY id DESC LIMIT 10`);
  console.log("RECENT EMAIL MESSAGES:", msgs);

  process.exit(0);
}

inspectLogs();
