const deletionService = require('./deletion.service');
const ApiResponse = require('../../utils/apiResponse');

class DeletionController {
  async getRequests(req, res) {
    const requests = await deletionService.getDeletionRequests();
    res.json(ApiResponse.success(requests));
  }

  async approve(req, res) {
    await deletionService.approveDeletion(req.params.id, req.user.id);
    res.json(ApiResponse.success(null, 'Deletion approved. User archived.'));
  }

  async reject(req, res) {
    await deletionService.rejectDeletion(req.params.id, req.user.id);
    res.json(ApiResponse.success(null, 'Deletion rejected.'));
  }

  async bulkApprove(req, res) {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'No user IDs provided for approval'));
    }
    await deletionService.bulkApproveDeletion(userIds, req.user.id);
    res.json(ApiResponse.success(null, 'Selected deletion requests approved.'));
  }

  async bulkReject(req, res) {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'No user IDs provided for rejection'));
    }
    await deletionService.bulkRejectDeletion(userIds, req.user.id);
    res.json(ApiResponse.success(null, 'Selected deletion requests rejected.'));
  }
}

module.exports = new DeletionController();
