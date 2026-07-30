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
}

module.exports = new DeletionController();
