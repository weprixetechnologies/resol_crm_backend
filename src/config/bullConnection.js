const env = require('./env');

const parseRedisUrl = (urlStr) => {
  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parseInt(parsed.port || '6379'),
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    };
  } catch (err) {
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    };
  }
};

const connection = parseRedisUrl(env.REDIS_URL);

module.exports = connection;
