const { logger } = require('../../utils/logger');
const { redisManager } = require('../redisManager');

// Meta keeps an uploaded media id valid and reusable for 30 days; cache with
// a safety margin so a carousel send never depends on re-fetching the same
// static image from its source URL (e.g. Wikimedia) on every single send -
// a real rate-limit there was observed to falsely trigger the carousel
// fallback in production testing.
const MEDIA_ID_CACHE_TTL_SECONDS = 25 * 24 * 60 * 60;

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

  async sendCtaUrl({ to, body, image, buttonText, url: linkUrl, footer } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const targetUrl = String(linkUrl || '').trim();
    if (!targetUrl) {
      throw new Error('sendCtaUrl requires a non-empty url');
    }

    const messagesUrl = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    const imageLink = String(image || '').trim();
    // Meta caps CTA URL button text at 20 characters.
    const displayText = utf16SliceSafe(String(buttonText || 'Open link').trim() || 'Open link', 20);
    const footerText = utf16SliceSafe(String(footer || ''), 60).trim();

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        ...(imageLink ? { header: { type: 'image', image: { link: imageLink } } } : {}),
        body: { text: String(body || '') },
        action: {
          name: 'cta_url',
          parameters: { display_text: displayText, url: targetUrl }
        },
        ...(footerText ? { footer: { text: footerText } } : {})
      }
    };

    return this._postWithRetry(messagesUrl, payload);
  }

  // Carousel template headers reference an uploaded media id, not a public URL
  // (unlike sendImage/sendButtons' image headers) - download the asset and
  // re-upload it to Meta's Media API to get that id.
  async uploadMedia({ link } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const sourceUrl = String(link || '').trim();
    if (!sourceUrl) {
      throw new Error('uploadMedia requires a non-empty link');
    }

    const cacheKey = `wa:media-id:${this.phoneNumberId}:${sourceUrl}`;
    const cachedMediaId = await redisManager.get(cacheKey).catch(() => null);
    if (cachedMediaId) {
      return cachedMediaId;
    }

    const imageRes = await this._downloadWithRetry(sourceUrl);
    const arrayBuffer = await imageRes.arrayBuffer();
    const contentType = (imageRes.headers && imageRes.headers.get && imageRes.headers.get('content-type')) || 'image/jpeg';

    const base = String(this.apiBase || 'https://graph.facebook.com').replace(/\/$/, '');
    const version = String(this.apiVersion || 'v20.0').replace(/^\//, '');
    const uploadUrl = `${base}/${version}/${encodeURIComponent(this.phoneNumberId)}/media`;

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([arrayBuffer], { type: contentType }), 'image.jpg');

    const res = await this.fetchImpl(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form
    });

    const data = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }));
    if (!res.ok || !data.id) {
      logger.warn('WhatsApp media upload failed', data);
      throw new Error(`uploadMedia failed (status=${res.status})`);
    }

    await redisManager.setex(cacheKey, MEDIA_ID_CACHE_TTL_SECONDS, data.id).catch(() => {});

    return data.id;
  }

  async sendCarouselTemplate({ to, templateName, languageCode, bodyParams, cards } = {}) {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp client not configured (missing accessToken/phoneNumberId)');
    }

    const name = String(templateName || '').trim();
    if (!name) {
      throw new Error('sendCarouselTemplate requires a non-empty templateName');
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error('sendCarouselTemplate requires a non-empty cards array');
    }

    const cardComponents = [];
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index] || {};
      const buttonType = card.buttonType === 'url' ? 'url' : 'quick_reply';

      let buttonComponent;
      if (buttonType === 'quick_reply') {
        const payload = String(card.quickReplyPayload || '').trim();
        if (!payload) {
          throw new Error(`sendCarouselTemplate: card ${index} is missing quickReplyPayload`);
        }
        buttonComponent = {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload }]
        };
      } else {
        // A fully static URL button (no {{1}} variable) has nothing to
        // substitute, so it carries no `parameters` - the URL itself is
        // baked into the approved template at card-definition time, same as
        // any other WhatsApp template button with zero variables.
        buttonComponent = { type: 'button', sub_type: 'url', index: '0' };
      }

      // eslint-disable-next-line no-await-in-loop
      const mediaId = card.imageMediaId || (card.imageLink ? await this.uploadMedia({ link: card.imageLink }) : null);
      if (!mediaId) {
        throw new Error(`sendCarouselTemplate: card ${index} is missing imageLink/imageMediaId`);
      }

      cardComponents.push({
        card_index: index,
        components: [{ type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] }, buttonComponent]
      });
    }

    const messagesUrl = buildMessagesUrl({
      apiBase: this.apiBase,
      apiVersion: this.apiVersion,
      phoneNumberId: this.phoneNumberId
    });

    const safeBodyParams = Array.isArray(bodyParams) ? bodyParams : [];

    const templatePayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: languageCode || 'en_US' },
        components: [
          ...(safeBodyParams.length
            ? [{ type: 'body', parameters: safeBodyParams.map((text) => ({ type: 'text', text: String(text) })) }]
            : []),
          { type: 'carousel', cards: cardComponents }
        ]
      }
    };

    return this._postWithRetry(messagesUrl, templatePayload);
  }

  // Wikimedia (and other public image hosts backing carouselTemplate cards)
  // rate-limit aggressively - a single 429 here used to kill the whole
  // uploadMedia call and, with it, the entire carousel send. Same
  // retry/backoff shape as _postWithRetry, applied to the source-image
  // download instead of the WhatsApp API call.
  async _downloadWithRetry(sourceUrl) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await this.fetchImpl(sourceUrl);
      if (res.ok) {
        return res;
      }

      const status = res.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      logger.warn(`uploadMedia: source image download error (status=${status}, retryable=${retryable})`, sourceUrl);

      if (!retryable || attempt === maxAttempts) {
        throw new Error(`uploadMedia: failed to download ${sourceUrl} (status=${status})`);
      }

      // Exponential backoff with small base delay
      // eslint-disable-next-line no-await-in-loop
      await sleep(250 * 2 ** (attempt - 1));
    }

    throw new Error(`uploadMedia: failed to download ${sourceUrl}`);
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
