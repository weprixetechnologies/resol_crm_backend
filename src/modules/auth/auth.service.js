const db = require('../../config/db');
const redis = require('../../config/redis');
const env = require('../../config/env');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Helper to convert time strings like "15m" or "7d" to seconds for Redis TTL
const parseDurationToSeconds = (duration) => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 86400; // default 1 day
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 86400;
  }
};

class AuthService {
  async login(email, password, ip, userAgent) {
    const [rows] = await db.query('SELECT * FROM staff WHERE email = ?', [email]);
    const user = rows[0];

    if (!user) {
      const error = new Error('Invalid credentials');
      error.statusCode = 401;
      throw error;
    }

    if (user.is_disabled) {
      const error = new Error('Account disabled');
      error.statusCode = 403;
      error.code = 'ACCOUNT_DISABLED';
      throw error;
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      const error = new Error('Invalid credentials');
      error.statusCode = 401;
      throw error;
    }

    const sessionId = crypto.randomUUID();
    
    // Issue Tokens
    const accessToken = jwt.sign({ userId: user.id, sessionId }, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN });
    const refreshToken = jwt.sign({ userId: user.id, sessionId }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN });

    // Store session in Redis
    const sessionKey = `session:${user.id}:${sessionId}`;
    const now = new Date().toISOString();
    
    await redis.hset(sessionKey, {
      role: user.role,
      name: user.name,
      loginAt: now,
      lastActiveAt: now,
      ip: ip || 'unknown',
      userAgent: userAgent || 'unknown'
    });
    
    // Set TTL to match refresh token
    const ttlSeconds = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
    await redis.expire(sessionKey, ttlSeconds);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        staff_code: user.staff_code
      }
    };
  }

  async refresh(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
      const { userId, sessionId } = decoded;

      const sessionKey = `session:${userId}:${sessionId}`;
      const sessionExists = await redis.exists(sessionKey);
      
      if (!sessionExists) {
        const error = new Error('Session revoked');
        error.statusCode = 401;
        throw error;
      }

      // Generate a new access token (keep the same session ID and refresh token valid)
      const accessToken = jwt.sign({ userId, sessionId }, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN });
      
      return { accessToken };
    } catch (err) {
      const error = new Error('Invalid or expired refresh token');
      error.statusCode = 401;
      throw error;
    }
  }

  async logout(userId, sessionId) {
    const sessionKey = `session:${userId}:${sessionId}`;
    await redis.del(sessionKey);
  }

  async getMe(userId) {
    const [rows] = await db.query('SELECT id, name, email, role, staff_code FROM staff WHERE id = ?', [userId]);
    if (rows.length === 0) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    return rows[0];
  }
}

module.exports = new AuthService();
