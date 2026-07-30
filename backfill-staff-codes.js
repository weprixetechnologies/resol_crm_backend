const db = require('./src/config/db');
const staffService = require('./src/modules/staff/staff.service');

async function run() {
  try {
    console.log('Fetching staff members with NULL staff_code...');
    const [rows] = await db.query('SELECT id, name FROM staff WHERE staff_code IS NULL');
    
    if (rows.length === 0) {
      console.log('No staff members found requiring a backfill. Everyone has a staff code!');
      process.exit(0);
    }
    
    console.log(`Found ${rows.length} staff members to update.`);
    
    for (const user of rows) {
      const code = await staffService.generateUniqueStaffCode(user.name);
      await db.query('UPDATE staff SET staff_code = ? WHERE id = ?', [code, user.id]);
      console.log(`Updated Staff ID ${user.id} (${user.name}) -> Code: ${code}`);
    }
    
    console.log('Backfill completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error during backfill:', error);
    process.exit(1);
  }
}

run();
