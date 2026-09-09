const mysql = require('mysql2/promise');

async function listUsers() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'adminuser',
    password: 'Vishal@13241',
    database: 'resol_crm'
  });

  const [rows] = await connection.query('SELECT id, name FROM users');
  console.log("Users in DB:", rows);

  await connection.end();
}

listUsers();
