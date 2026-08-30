const mailService = require('./mail.service');
const ApiResponse = require('../../utils/apiResponse');

class MailController {
  async testConnection(req, res) {
    const result = await mailService.testConnection(req.body);
    res.json(ApiResponse.success(result, 'SMTP Connection test succeeded!'));
  }

  async getTemplates(req, res) {
    const templates = await mailService.getTemplates();
    res.json({ success: true, templates, data: templates });
  }

  async getTemplateById(req, res) {
    const template = await mailService.getTemplateById(req.params.id);
    res.json(ApiResponse.success(template));
  }

  async createTemplate(req, res) {
    try {
      const creatorId = req.user ? req.user.id : null;
      const result = await mailService.createTemplate(req.body, creatorId);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        success: false,
        error: {
          code: err.code || 'TEMPLATE_CREATION_FAILED',
          message: err.message
        }
      });
    }
  }

  async updateTemplate(req, res) {
    const updaterId = req.user ? req.user.id : null;
    const template = await mailService.updateTemplate(req.params.id, req.body, updaterId);
    res.json(ApiResponse.success(template, 'Template updated successfully'));
  }

  async deleteTemplate(req, res) {
    const deleterId = req.user ? req.user.id : null;
    const result = await mailService.deleteTemplate(req.params.id, deleterId);
    res.json(ApiResponse.success(result, 'Template deleted successfully'));
  }

  async getTemplateStatus(req, res) {
    try {
      const crmTemplateId = req.params.crmTemplateId || req.params.id;
      const result = await mailService.getTemplateStatus(crmTemplateId);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        success: false,
        crmTemplateId: parseInt(req.params.crmTemplateId || req.params.id, 10) || null,
        status: 'PENDING',
        canSend: false,
        error: {
          code: err.code || 'STATUS_CHECK_FAILED',
          message: err.message
        }
      });
    }
  }

  async sendMail(req, res) {
    try {
      const senderId = req.user ? req.user.id : null;
      const result = await mailService.sendMail(req.body, senderId);
      res.json(result);
    } catch (err) {
      if (err.code === 'TEMPLATE_NOT_APPROVED' || err.code === 'TEMPLATE_REJECTED') {
        return res.status(422).json({
          success: false,
          code: err.code,
          message: err.message,
          status: err.status || 'PENDING',
          canSend: false
        });
      }
      res.status(err.statusCode || 400).json({
        success: false,
        error: {
          code: err.code || 'SEND_FAILED',
          message: err.message
        }
      });
    }
  }

  async getQueueStatus(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const status = await mailService.getQueueStatus();
    res.json(ApiResponse.success(status));
  }

  async getLogs(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const logs = await mailService.getLogs(page, limit, search);
    res.json(ApiResponse.success(logs));
  }

  async syncTemplateToMsg91(req, res) {
    const result = await mailService.getTemplateStatus(req.params.id);
    res.json(ApiResponse.success(result, 'Template status successfully refreshed from MSG91!'));
  }

  async syncAllTemplatesToMsg91(req, res) {
    const results = await mailService.syncAllTemplatesToMsg91();
    res.json(ApiResponse.success(results, 'Batch template status sync with MSG91 completed!'));
  }

  async getMsg91TemplatesLive(req, res) {
    const results = await mailService.getMsg91TemplatesLive();
    res.json(ApiResponse.success(results));
  }

  async getMsg91Logs(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const results = await mailService.getMsg91EmailLogs(req.query);
    res.json(ApiResponse.success(results));
  }

  async getAnalytics(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { startDate, endDate } = req.query;
    const result = await mailService.getAnalytics(startDate, endDate);
    res.json(result);
  }

  async getLogs(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const result = await mailService.getLogs(req.query);
    res.json(ApiResponse.success(result));
  }

  async getLogJourney(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const result = await mailService.getLogJourney(req.params.id);
    res.json(result);
  }

  async reconcileMsg91Logs(req, res) {
    const { fromDate, toDate, startDate, endDate } = req.body || req.query;
    const result = await mailService.reconcileMsg91Logs(fromDate || startDate, toDate || endDate);
    res.json(result);
  }

  async getTemplateVersionDetails(req, res) {
    try {
      const msg91Provider = require('../../integrations/email/msg91.provider');
      const data = await msg91Provider.getTemplateVersionDetails(req.params.versionId);
      res.json(ApiResponse.success(data));
    } catch (err) {
      res.status(500).json(ApiResponse.error(err.message));
    }
  }

  async getBounces(req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const result = await mailService.getBounces(req.query);
    res.json(result);
  }

  async deleteBouncedContact(req, res) {
    const deleterId = req.user ? req.user.id : null;
    const result = await mailService.deleteBouncedContact(req.params.id, deleterId);
    res.json(ApiResponse.success(result, result.message));
  }

  async bulkRequestDeletion(req, res) {
    const requesterId = req.user ? req.user.id : null;
    const requesterRole = req.user ? req.user.role : 'staff';
    const result = await mailService.bulkRequestDeletionLogs(req.body, requesterId, requesterRole);
    res.json(ApiResponse.success(result, result.message));
  }
}

module.exports = new MailController();
