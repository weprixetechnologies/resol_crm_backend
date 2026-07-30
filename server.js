const app = require('./src/app');
const env = require('./src/config/env');
const db = require('./src/config/db');
const redis = require('./src/config/redis');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...', err);
  // Ideally, close server gracefully before exiting
  process.exit(1);
});

const startServer = async () => {
  try {
    // Verify database connection
    await db.query('SELECT 1');
    console.log('Database connected successfully');
    
    // Redis connection is handled in config/redis.js, we assume it's connecting in the background
    
    app.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
