const redis = require('../config/redis');
const ApiResponse = require('../utils/apiResponse');

/**
 * Basic IP-based rate limiter using Redis
 * Allows 'limit' requests per 'windowSeconds'
 */
const rateLimiter = (limit = 10, windowSeconds = 60) => {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;
      const key = `rate_limit:${ip}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      if (current > limit) {
        return res.status(429).json(
          ApiResponse.error('TOO_MANY_REQUESTS', 'You have exceeded your request limit. Please try again later.')
        );
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Fail open if Redis is down
      next();
    }
  };
};

module.exports = rateLimiter;
