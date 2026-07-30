const authService = require('./auth.service');
const ApiResponse = require('../../utils/apiResponse');

class AuthController {
  async login(req, res) {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Email and password are required'));
    }

    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authService.login(email, password, ip, userAgent);
    res.json(ApiResponse.success(result, 'Login successful'));
  }

  async refresh(req, res) {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'Refresh token is required'));
    }

    const result = await authService.refresh(refreshToken);
    res.json(ApiResponse.success(result, 'Token refreshed'));
  }

  async logout(req, res) {
    const { id, sessionId } = req.user;
    await authService.logout(id, sessionId);
    res.json(ApiResponse.success(null, 'Logged out'));
  }

  async me(req, res) {
    const { id } = req.user;
    const user = await authService.getMe(id);
    res.json(ApiResponse.success(user));
  }
}

module.exports = new AuthController();
