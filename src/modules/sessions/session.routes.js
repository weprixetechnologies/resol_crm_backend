const express = require('express');
const sessionController = require('./session.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// Admin only
router.use(authMiddleware, requireRole('admin'));

router.get('/', asyncHandler(sessionController.getSessions));
router.delete('/:userId/:sessionId', asyncHandler(sessionController.forceLogout));

module.exports = router;
