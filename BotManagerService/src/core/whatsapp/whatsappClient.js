const { logger } = require('../../utils/logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMessagesUrl({ apiBase, apiVersion, phoneNumberId }) {
  const base = String(apiBase || 'https://graph.facebook.com').replace(/\/$/, '');
  const version = String(apiVersion || 'v20.0').replace(/^\//, '');
  return `${base}/${version}/${encodeURIComponent(phoneNumberId)}/messages`;
}

function utf16SliceSafe(text, maxCodeUnits) {
  const input = String(text || '');
  const max = Math.max(0, Number(maxCodeUnits) || 0);
  if (!max) return '';

  let sliced = input.slice(0, max);

  // Avoid cutting a surrogate pair in half.
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }

  return sliced;
}

function normalizeButtonTitle(title) {
  const trimmed = String(title || '').trim();
  const safe = trimmed || 'Option';
  const limited = utf16SliceSafe(safe, 20);
  return limited.trim() ? limited : 'Option';
}

class WhatsAppCloudClient {
  constructor({ accessToken, phoneNumberId, apiVersion, apiBase, fetchImpl } = {}) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion || 'v20.0';
    this.apiBase = apiBase || 'https://graph.facebook.com';
    this.fetchImpl = fetchImpl || global.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch is not available (Node 18+ required)');
    }
  }

  isConfigured() {
    return Boolean(this.accessToken) && Boolean(this.phoneNumberId);
  }

  async sendText({ to, body, previewUrl } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const url = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: String(body || ''),
        preview_url: Boolean(previewUrl)
      }
    };

    return this._postWithRetry(url, payload);
  }

  async sendButtons({ to, body, buttons, image } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const url = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    const safeButtons = Array.isArray(buttons) ? buttons : [];
    const limitedButtons = safeButtons.slice(0, 3);
    const imageLink = String(image || '').trim();

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(imageLink ? { header: { type: 'image', image: { link: imageLink } } } : {}),
        body: {
          text: String(body || '')
        },
        action: {
          buttons: limitedButtons.map((button) => {
            const id = String(button?.id || '').trim();
            const title = normalizeButtonTitle(button?.title);

            return {
              type: 'reply',
              reply: {
                id: id || title,
                title: title || id
              }
            };
          })
        }
      }
    };

    return this._postWithRetry(url, payload);
  }

  async sendList({ to, body, buttonText, sections } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const url = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    const safeSections = Array.isArray(sections) ? sections : [];
    const normalizedSections = safeSections
      .map((section) => {
        const title = String(section?.title || '').trim();
        const rows = Array.isArray(section?.rows) ? section.rows : [];
        const normalizedRows = rows
          .map((row) => {
            const id = String(row?.id || '').trim();
            const rowTitle = String(row?.title || '').trim();
            const description = row?.description != null ? String(row.description) : undefined;
            if (!id || !rowTitle) return null;
            const baseRow = { id, title: rowTitle };
            if (description && description.trim()) return { ...baseRow, description: description.trim() };
            return baseRow;
          })
          .filter(Boolean)
          .slice(0, 10);

        if (!title || normalizedRows.length === 0) return null;
        return { title, rows: normalizedRows };
      })
      .filter(Boolean)
      .slice(0, 10);

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: String(body || '')
        },
        action: {
          button: String(buttonText || 'Select'),
          sections: normalizedSections
        }
      }
    };

    return this._postWithRetry(url, payload);
  }

  async sendImage({ to, link, caption } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const imageLink = String(link || '').trim();
    if (!imageLink) {
      throw new Error('sendImage requires a non-empty link');
    }

    const url = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    // WhatsApp caps media captions at 1024 characters.
    const safeCaption = utf16SliceSafe(String(caption || ''), 1024).trim();

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        link: imageLink,
        ...(safeCaption ? { caption: safeCaption } : {})
      }
    };

    return this._postWithRetry(url, payload);
  }

  async _postWithRetry(url, payload) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        // eslint-disable-next-line no-await-in-loop
        return await res.json();
      }

      const status = res.status;
      let bodyText = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        bodyText = await res.text();
      } catch (_err) {
        bodyText = '';
      }

      const retryable = status === 429 || (status >= 500 && status <= 599);
      logger.warn(`WhatsApp API error (status=${status}, retryable=${retryable})`, bodyText);

      if (!retryable || attempt === maxAttempts) {
        throw new Error(`WhatsApp API request failed (status=${status})`);
      }

      // Exponential backoff with small base delay
      // eslint-disable-next-line no-await-in-loop
      await sleep(250 * 2 ** (attempt - 1));
    }

    throw new Error('WhatsApp API request failed');
  }
}

module.exports = { WhatsAppCloudClient, buildMessagesUrl };
