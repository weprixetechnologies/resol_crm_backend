const importService = require('./import.service');
const ApiResponse = require('../../utils/apiResponse');

class ImportController {
  async preview(req, res) {
    if (!req.file) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'No file uploaded'));
    }
    
    const preview = await importService.previewImport(req.file.buffer);
    res.json(ApiResponse.success(preview, 'Preview generated'));
  }

  async commit(req, res) {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json(ApiResponse.error('VALIDATION_ERROR', 'No rows provided for commit'));
    }
    
    const result = await importService.commitImport(rows, req.user.id, req.user.role);
    res.json(ApiResponse.success(result, `Successfully imported ${result.count} records`));
  }
}

module.exports = new ImportController();
