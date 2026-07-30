const express = require('express');
const multer = require('multer');
const importController = require('./import.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Admin only
router.use(authMiddleware, requireRole('admin'));

router.post('/preview', upload.single('file'), asyncHandler(importController.preview));
router.post('/commit', asyncHandler(importController.commit));

module.exports = router;
