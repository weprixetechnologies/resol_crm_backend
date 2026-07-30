const jwt = require('jsonwebtoken');
const env = require('../config/env');
const redis = require('../config/redis');
const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Missing or invalid token'));
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch (error) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Invalid or expired token'));
    }

    const { userId, sessionId } = decoded;

    // Check Redis session registry
    const sessionKey = `session:${userId}:${sessionId}`;
    const sessionExists = await redis.exists(sessionKey);

    if (!sessionExists) {
      return res.status(401).json(ApiResponse.error('SESSION_REVOKED', 'Session has been revoked or expired. Please login again.'));
    }

    // Check if staff is disabled (to handle edge cases where session wasn't properly killed)
    const [rows] = await db.query('SELECT role, is_disabled FROM staff WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'User not found'));
    }
    
    if (rows[0].is_disabled) {
      return res.status(403).json(ApiResponse.error('ACCOUNT_DISABLED', 'Account is disabled'));
    }

    // Update lastActiveAt in Redis
    await redis.hset(sessionKey, 'lastActiveAt', new Date().toISOString());

    // Attach user to request
    req.user = {
      id: userId,
      sessionId: sessionId,
      role: rows[0].role
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json(ApiResponse.error('INTERNAL_SERVER_ERROR', 'Authentication failed'));
  }
};

module.exports = authMiddleware;
