const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Running migrations...');
    const safeAddColumn = async (query) => {
      try {
        await db.query(query);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`Column already exists: ${query}`);
        } else {
          throw err;
        }
      }
    };

    await safeAddColumn(`ALTER TABLE users ADD COLUMN is_admin_verified TINYINT(1) NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN is_deletion_requested TINYINT(1) NOT NULL DEFAULT 0;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN deletion_reason VARCHAR(255) NULL;`);

    // New fields: status, tag1, tag2
    await safeAddColumn(`ALTER TABLE users ADD COLUMN status ENUM('active','unverified') NOT NULL DEFAULT 'active';`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN tag1 VARCHAR(255) NULL;`);
    await safeAddColumn(`ALTER TABLE users ADD COLUMN tag2 VARCHAR(255) NULL;`);

    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN status ENUM('active','unverified') NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN tag1 VARCHAR(255) NULL;`);
    await safeAddColumn(`ALTER TABLE archived_users ADD COLUMN tag2 VARCHAR(255) NULL;`);

    console.log('Migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
