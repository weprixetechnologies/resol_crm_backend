require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Hidden password prompt implementation
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
  console.log('--- Database Reset & Admin Seeder ---\n');
  
  try {
    const adminEmail = await question('Admin Email: ');
    if (!adminEmail.includes('@')) {
      console.error('\nError: Invalid email format.');
      process.exit(1);
    }
    
    const adminPassword = await hiddenQuestion('Admin Password: ');
    if (adminPassword.length < 6) {
      console.error('\nError: Admin password must be at least 6 characters.');
      process.exit(1);
    }

    const portalPassword = await hiddenQuestion('New Portal Password for DB Wipe: ');
    const confirmPortalPassword = await hiddenQuestion('Confirm New Portal Password: ');
    
    if (portalPassword !== confirmPortalPassword) {
      console.error('\nError: Portal passwords do not match.');
      process.exit(1);
    }
    
    if (portalPassword.length < 6) {
      console.error('\nError: Portal password must be at least 6 characters.');
      process.exit(1);
    }

    // 1. Create or Update Admin Account
    console.log('\nCreating/Updating Admin Account...');
    const salt = await bcrypt.genSalt(10);
    const adminHash = await bcrypt.hash(adminPassword, salt);
    
    // We will use 'Admin' as default name and 'admin' role
    await db.query(`
      INSERT INTO staff (name, email, password_hash, role) 
      VALUES ('Super Admin', ?, ?, 'admin')
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin'
    `, [adminEmail, adminHash]);

    // Fetch the admin ID for tracking
    const [staffRows] = await db.query('SELECT id FROM staff WHERE email = ?', [adminEmail]);
    const adminId = staffRows[0].id;

    console.log('Admin account seeded successfully.');
    
    // 2. Hash new portal password and save
    console.log('Setting up Portal Password...');
    const portalHash = await bcrypt.hash(portalPassword, salt);
    
    // Save to system_settings
    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value, updated_by) 
      VALUES ('wipe_portal_password', ?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)
    `, [portalHash, adminId]);
    
    console.log('\nSuccess! Admin and Portal password have been securely saved to the database.');
    
  } catch (error) {
    console.error('\nAn unexpected error occurred:', error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

run();
