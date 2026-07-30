require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const hiddenQuestion = (query) => {
  return new Promise((resolve) => {
    process.stdout.write(query);
    let password = '';
    
    const onDataHandler = (char) => {
      char = char + '';
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.removeListener('data', onDataHandler);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(password);
          break;
        case '\u0003': // Ctrl+C
          process.exit();
          break;
        default:
          password += char;
          process.stdout.write('*');
          break;
      }
    };
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onDataHandler);
  });
};

async function run() {
  console.log('--- Reset Database Portal Password ---\n');
  
  try {
    const adminEmail = await question('Admin Email: ');
    const adminPassword = await hiddenQuestion('Admin Password: ');
    
    // Verify Admin
    const [staffRows] = await db.query('SELECT * FROM staff WHERE email = ? AND role = "admin"', [adminEmail]);
    if (staffRows.length === 0) {
      console.error('\nError: Admin user not found.');
      process.exit(1);
    }
    
    const admin = staffRows[0];
    const isMatch = await bcrypt.compare(adminPassword, admin.password_hash);
    if (!isMatch) {
      console.error('\nError: Incorrect admin password.');
      process.exit(1);
    }
    
    console.log('\nAuthentication successful.\n');
    
    const portalPassword = await hiddenQuestion('Enter New Portal Password: ');
    const confirmPortalPassword = await hiddenQuestion('Confirm New Portal Password: ');
    
    if (portalPassword !== confirmPortalPassword) {
      console.error('\nError: Portal passwords do not match.');
      process.exit(1);
    }
    
    if (portalPassword.length < 6) {
      console.error('\nError: Portal password must be at least 6 characters.');
      process.exit(1);
    }
    
    // Hash new portal password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(portalPassword, salt);
    
    // Save to system_settings
    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value, updated_by) 
      VALUES ('wipe_portal_password', ?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)
    `, [hash, admin.id]);
    
    console.log('\nSuccess! Portal password has been reset successfully.');
    
  } catch (error) {
    console.error('\nAn unexpected error occurred:', error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

run();
