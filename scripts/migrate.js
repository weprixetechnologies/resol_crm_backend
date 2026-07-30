const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Running migrations...');
    await db.query(`ALTER TABLE users ADD COLUMN is_admin_verified TINYINT(1) NOT NULL DEFAULT 0;`);
    await db.query(`ALTER TABLE users ADD COLUMN is_deletion_requested TINYINT(1) NOT NULL DEFAULT 0;`);
    await db.query(`ALTER TABLE users ADD COLUMN deletion_reason VARCHAR(255) NULL;`);
    console.log('Migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Columns already exist.');
      process.exit(0);
    }
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
