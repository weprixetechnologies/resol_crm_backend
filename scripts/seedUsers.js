const mysql = require('mysql2/promise');

async function seedUsers() {
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: 'rseditz@222',
      database: 'vishalji_crm'
    });

    const dummyUsers = [
      ['John Doe', 'john.doe@example.com', '1234567890', 'Mumbai', 'IIT Bombay', 'Computer Science', 'manual', 1],
      ['Jane Smith', 'jane.smith@example.com', '0987654321', 'Delhi', 'Delhi University', 'Physics', 'public_form', null],
      ['Alice Johnson', 'alice.j@example.com', '5551234567', 'Bangalore', 'IISC', 'Mathematics', 'import', null],
      ['Bob Brown', 'bob.b@example.com', '4449876543', 'Chennai', 'IIT Madras', 'Chemistry', 'manual', 1],
      ['Charlie Davis', 'charlie.d@example.com', '3335678901', 'Pune', 'Pune University', 'Biology', 'public_form', null]
    ];

    for (const user of dummyUsers) {
      await connection.query(
        `INSERT INTO users (name, email, mobile, city, institute, department, source, created_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        user
      );
    }

    console.log('Successfully seeded 5 dummy users.');
    
    // Create some audit logs as well to populate the timeline
    for (let i = 1; i <= 5; i++) {
        await connection.query(
            `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, meta)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [1, 'admin', 'create', 'user', i, JSON.stringify({ note: 'Seeded via script' })]
        );
    }

    await connection.end();
  } catch (error) {
    console.error('Error seeding users:', error);
    process.exit(1);
  }
}

seedUsers();
