const express = require('express');
const userService = require('../users/user.service');
const rateLimiter = require('../../middlewares/rateLimiter.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');
const redis = require('../../config/redis');
const db = require('../../config/db');
const ApiResponse = require('../../utils/apiResponse');

const router = express.Router();

// Helper to check if public form is enabled
const checkFormStatus = async (req, res, next) => {
  const settingsStr = await redis.get('system_settings');
  if (settingsStr) {
    const settings = JSON.parse(settingsStr);
    if (!settings.form_submission_enabled) {
      return res.status(403).json(ApiResponse.error('FORBIDDEN', 'Form submissions are currently closed'));
    }
  }
  next();
};

const verifyStaffCode = async (req, res, next) => {
  const { staffcode } = req.body;
  if (!staffcode) {
    return res.status(400).json(ApiResponse.error('BAD_REQUEST', 'Staff code is required'));
  }
  
  const [staffRows] = await db.query('SELECT id FROM staff WHERE staff_code = ? AND is_disabled = 0 LIMIT 1', [staffcode]);
  
  if (staffRows.length === 0) {
    return res.status(403).json(ApiResponse.error('FORBIDDEN', 'Invalid or inactive staff code'));
  }
  
  // Attach staff info if needed for auditing, though the spec doesn't explicitly require it
  req.staff_id_from_code = staffRows[0].id;
  next();
};

router.post(
  '/submit',
  rateLimiter(5, 60), // 5 requests per minute
  checkFormStatus,
  verifyStaffCode,
  asyncHandler(async (req, res) => {
    // For public submissions, overrideFuzzy is true so that Tier 2 matches don't block submission.
    // (Only Tier 1 exact matches will block).
    const user = await userService.createUser(req.body, req.staff_id_from_code, 'public', true);
    res.status(201).json(ApiResponse.success({ id: user.id }, 'Submission successful'));
  })
);

module.exports = router;
