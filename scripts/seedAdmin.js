const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

async function seedAdmin() {
  try {
    console.log('Seeding admin user...');
    const name = 'Admin';
    const email = 'admin@example.com';
    const password = 'password123';
    
    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // Insert into DB
    const [result] = await pool.execute(
      'INSERT INTO staff (name, email, password_hash, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = ?, role = ?',
      [name, email, password_hash, 'admin', password_hash, 'admin']
    );
    
    console.log('Admin user seeded successfully!');
    console.log('--------------------------------');
    console.log(`Email (ID): ${email}`);
    console.log(`Password:   ${password}`);
    console.log('--------------------------------');
    
  } catch (error) {
    console.error('Error seeding admin user:', error);
  } finally {
    process.exit(0);
  }
}

seedAdmin();
