const sessionService = require('./session.service');
const ApiResponse = require('../../utils/apiResponse');

class SessionController {
  async getSessions(req, res) {
    const sessions = await sessionService.getActiveSessions();
    res.json(ApiResponse.success(sessions));
  }

  async forceLogout(req, res) {
    const { userId, sessionId } = req.params;
    const success = await sessionService.forceLogout(userId, sessionId, req.user.id);
    if (!success) {
      return res.status(404).json(ApiResponse.error('NOT_FOUND', 'Session not found'));
    }
    res.json(ApiResponse.success(null, 'User successfully logged out'));
  }
}

module.exports = new SessionController();
