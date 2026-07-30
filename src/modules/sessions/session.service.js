const redis = require('../../config/redis');
const auditService = require('../audit/audit.service');

class SessionService {
  async getActiveSessions() {
    const keys = await redis.keys('session:*:*');
    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();

    return keys.map((key, index) => {
      const [err, data] = results[index];
      const parts = key.split(':'); // session:userId:sessionId
      return {
        key,
        userId: parts[1],
        sessionId: parts[2],
        ...data
      };
    }).sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
  }

  async forceLogout(userId, sessionId, adminId) {
    const key = `session:${userId}:${sessionId}`;
    const deleted = await redis.del(key);
    
    if (deleted) {
      await auditService.log({
        actorId: adminId,
        actorRole: 'admin',
        action: 'SESSION_FORCE_LOGOUT',
        entityType: 'staff',
        entityId: userId,
        meta: { sessionId }
      });
    }
    
    return deleted > 0;
  }
}

module.exports = new SessionService();
