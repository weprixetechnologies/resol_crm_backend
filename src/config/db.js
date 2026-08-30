require('dotenv').config();

const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  timezone: '+05:30',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Fallback pool for local dev environments where root/rseditz@222 is used
const fallbackPool = mysql.createPool({
  host: '127.0.0.1',
  user: 'root',
  password: 'rseditz@222',
  database: 'vishalji_crm',
  timezone: '+05:30',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

let activePool = pool;

const dbWrapper = {
  async query(sql, params) {
    try {
      return await activePool.query(sql, params);
    } catch (err) {
      if (err.code === 'ER_ACCESS_DENIED_ERROR' && activePool !== fallbackPool) {
        console.warn('[DB] Primary credentials failed, switching to local dev fallback pool...');
        activePool = fallbackPool;
        return await activePool.query(sql, params);
      }
      throw err;
    }
  },
  async getConnection() {
    try {
      return await activePool.getConnection();
    } catch (err) {
      if (err.code === 'ER_ACCESS_DENIED_ERROR' && activePool !== fallbackPool) {
        activePool = fallbackPool;
        return await activePool.getConnection();
      }
      throw err;
    }
  }
};

module.exports = dbWrapper;
