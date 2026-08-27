const express = require('express');
const router = express.Router();
const campaignController = require('./campaign.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireRole = require('../../middlewares/role.middleware');
const asyncHandler = require('../../middlewares/asyncHandler');

router.use(authMiddleware);

// Campaign CRUD & Dispatches
router.post('/', requireRole('admin'), asyncHandler(campaignController.createCampaign));
router.get('/', asyncHandler(campaignController.getCampaigns));

// Email Tracking Summary
router.get('/tracking/summary', asyncHandler(campaignController.getGlobalTrackingSummary));

router.get('/:id', asyncHandler(campaignController.getCampaignById));
router.get('/:id/analytics', asyncHandler(campaignController.getAnalytics));

// Campaign Recipient Management
router.post('/:id/recipients', requireRole('admin'), asyncHandler(campaignController.addRecipients));
router.delete('/:id/recipients/:contactId', requireRole('admin'), asyncHandler(campaignController.removeRecipient));

// Campaign Sending & Scheduling
router.post('/:id/send', requireRole('admin'), asyncHandler(campaignController.sendCampaign));
router.post('/:id/schedule', requireRole('admin'), asyncHandler(campaignController.scheduleCampaign));

module.exports = router;
