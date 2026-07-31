const express = require('express');
const deletionController = require('./deletion.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

// Only Admins can manage deletions
router.use(authMiddleware, requireRole('admin'));

router.get('/', asyncHandler(deletionController.getRequests));
router.post('/bulk-approve', asyncHandler(deletionController.bulkApprove));
router.post('/bulk-reject', asyncHandler(deletionController.bulkReject));
router.post('/:id/approve', asyncHandler(deletionController.approve));
router.post('/:id/reject', asyncHandler(deletionController.reject));

module.exports = router;
