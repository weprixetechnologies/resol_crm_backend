const express = require('express');
const staffController = require('./staff.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// All staff routes are admin-only
router.use(authMiddleware, requireRole('admin'));

router.post('/', asyncHandler(staffController.createStaff));
router.get('/', asyncHandler(staffController.getStaffList));
router.get('/:id', asyncHandler(staffController.getStaffById));
router.patch('/:id', asyncHandler(staffController.updateStaff));
router.delete('/:id', asyncHandler(staffController.deleteStaff));

module.exports = router;
