const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

async function initDB() {
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: 'rseditz@222',
      multipleStatements: true
    });

    console.log('Connected to MySQL. Executing schema...');
    
    const schemaPath = path.join(__dirname, '../src/config/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    await connection.query(schemaSql);
    console.log('Schema executed successfully.');

    // Seed initial admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    const [rows] = await connection.query(
      `SELECT id FROM vishalji_crm.staff WHERE email = 'admin@example.com'`
    );

    if (rows.length === 0) {
      await connection.query(
        `INSERT INTO vishalji_crm.staff (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
        ['Admin', 'admin@example.com', passwordHash, 'admin']
      );
      console.log('Initial admin user created: admin@example.com / admin123');
    } else {
      console.log('Admin user already exists.');
    }

    await connection.end();
    console.log('Database initialization complete.');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initDB();
