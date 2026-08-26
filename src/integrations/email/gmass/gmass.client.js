const env = require('../../../config/env');
const settingsService = require('../../../modules/settings/settings.service');

class GMassClient {
  constructor(apiKey = null, baseUrl = null) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || env.GMASS_BASE_URL || 'https://api.gmass.co/api/').replace(/\/+$/, '') + '/';
  }

  async getApiKey() {
    if (this.apiKey) return this.apiKey;
    const settings = await settingsService.getSettings();
    return settings.gmass_api_key || env.GMASS_API_KEY;
  }

  /**
   * Helper to perform HTTP requests to GMass API with authentication & retries.
   */
  async request(endpoint, options = {}) {
    const key = await this.getApiKey();
    if (!key) {
      const err = new Error('GMass API key is missing. Please configure GMASS_API_KEY in system settings or environment.');
      err.statusCode = 401;
      throw err;
    }

    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const url = new URL(cleanEndpoint, this.baseUrl);
    url.searchParams.set('apikey', key);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-apikey': key,
      ...(options.headers || {})
    };

    const fetchOpts = {
      method: options.method || 'GET',
      headers
    };

    if (options.body) {
      fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    let lastError = null;
    const maxRetries = options.retries || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[GMass Client] ${fetchOpts.method} ${url.pathname} (Attempt ${attempt}/${maxRetries})`);
        const response = await fetch(url.toString(), fetchOpts);

        const text = await response.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch {
          data = { rawText: text };
        }

        if (!response.ok) {
          const err = new Error(data.message || data.Message || data.error || `GMass API error HTTP ${response.status}`);
          err.statusCode = response.status;
          err.responseBody = data;
          
          // Retry on 5xx or 429 rate limit
          if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
            lastError = err;
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[GMass Client] Retrying after ${delay}ms due to HTTP ${response.status}...`);
            await new Promise(res => setTimeout(res, delay));
            continue;
          }
          throw err;
        }

        return data;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && (!err.statusCode || err.statusCode >= 500)) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * 1. Create a Campaign Draft
   * POST /api/campaigndrafts
   * Payload: { subject, message, emailAddresses, fromEmail, messageType, cc, bcc }
   */
  async createDraft(payload) {
    const body = {
      subject: payload.subject,
      message: payload.message || payload.bodyHtml,
      emailAddresses: Array.isArray(payload.emailAddresses) ? payload.emailAddresses.join(',') : payload.emailAddresses,
      ...(payload.fromEmail ? { fromEmail: payload.fromEmail } : {}),
      ...(payload.cc ? { cc: payload.cc } : {}),
      ...(payload.bcc ? { bcc: payload.bcc } : {})
    };

    return this.request('campaigndrafts', {
      method: 'POST',
      body
    });
  }

  /**
   * 2. Send or Schedule a Campaign from a Draft
   * POST /api/campaigns
   * Accepts draftId and settings (tracking, follow-ups, scheduling)
   */
  async sendCampaign(draftId, campaignOptions = {}) {
    const body = {
      ...(draftId ? { draftId, draftID: draftId } : {}),
      openTracking: campaignOptions.openTracking !== false,
      clickTracking: campaignOptions.clickTracking !== false,
      createDrafts: campaignOptions.createDrafts || false,
      verify: campaignOptions.verify || false,
      ...(campaignOptions.sendTime ? { sendTime: campaignOptions.sendTime } : {}),
      ...(campaignOptions.skipHolidays !== undefined ? { skipHolidays: campaignOptions.skipHolidays } : {}),
      ...(campaignOptions.emailsPerDay ? { emailsPerDay: campaignOptions.emailsPerDay } : {}),
      ...(campaignOptions.throttling ? { throttling: campaignOptions.throttling } : {}),
      ...(campaignOptions.replyTo ? { replyTo: campaignOptions.replyTo } : {}),
      ...(campaignOptions.fromName ? { fromName: campaignOptions.fromName } : {}),
      ...campaignOptions
    };

    // Note: If draftId is also needed in query or path based on OpenAPI specs:
    return this.request('campaigns', {
      method: 'POST',
      body
    });
  }

  /**
   * 3. Send Transactional Email
   * @deprecated UNIFIED CAMPAIGN ARCHITECTURE: Do not use /api/transactional. All sends (1 or N recipients) must use GMass Campaign flow (createDraft -> sendCampaign).
   * POST /api/transactional
   */
  async sendTransactional(payload) {
    console.warn('[GMassClient DEPRECATED] sendTransactional called. All dispatches should use GMass Campaign API flow.');
    return this.request('transactional', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * 4. Reports / Analytics Endpoints
   */
  async getCampaigns(limit = 50, offset = 0) {
    return this.request(`campaigns?limit=${limit}&offset=${offset}`);
  }

  async getCampaignStats(campaignId) {
    return this.request(`campaigns/${campaignId}`);
  }

  async getOpens(campaignId) {
    return this.request(`reports/${campaignId}/opens`);
  }

  async getClicks(campaignId) {
    return this.request(`reports/${campaignId}/clicks`);
  }

  async getReplies(campaignId) {
    return this.request(`reports/${campaignId}/replies`);
  }

  async getBounces(campaignId) {
    return this.request(`reports/${campaignId}/bounces`);
  }

  async getUnsubscribes(campaignId) {
    return this.request(`reports/${campaignId}/unsubscribes`);
  }

  async getRecipients(campaignId, limit = 100, offset = 0) {
    return this.request(`reports/${campaignId}/recipients?limit=${limit}&offset=${offset}`);
  }

  /**
   * 5. Unsubscribe Management
   * POST /api/unsubscribes
   */
  async addUnsubscribe(emailAddress) {
    return this.request('unsubscribes', {
      method: 'POST',
      body: { emailAddress }
    });
  }
}

module.exports = GMassClient;
