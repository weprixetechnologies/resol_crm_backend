const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('./auth.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts, please try again after a minute'
    }
  }
});

router.post('/login', loginLimiter, asyncHandler(authController.login));
router.post('/refresh', asyncHandler(authController.refresh));

// Protected routes
router.post('/logout', authMiddleware, asyncHandler(authController.logout));
router.get('/me', authMiddleware, asyncHandler(authController.me));

module.exports = router;
