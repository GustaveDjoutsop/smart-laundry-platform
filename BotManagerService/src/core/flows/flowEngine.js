const { renderTemplate } = require('./templateRenderer');
const { logger } = require('../../utils/logger');
const { waitForCarouselDelivery } = require('../whatsapp/messageStatusWaiter');

// Pulls the WhatsApp message id back out of a send() result so the caller
// can correlate it to a later delivery-status webhook (see
// messageStatusWaiter.js). send() results vary by outbound-intent type and
// by test double (a test stepper's stub send() commonly returns something
// else entirely, e.g. an array length), so this is deliberately tolerant -
// anything that doesn't look like a WhatsApp API response just yields null,
// which callers already treat as "fall back to the fixed-delay heuristic".
function extractMessageId(sendResult) {
  return sendResult?.messages?.[0]?.id || null;
}

// A successful send() for a template_carousel (or any image-bearing card)
// only means Meta accepted the API call - the message is then rendered and
// delivered to the device asynchronously on Meta's side, which is
// measurably slower than a plain interactive buttons message. Without
// waiting for that delivery, the footer buttons message (sent right after)
// reliably races ahead and displays before the carousel, even though we
// sent it second.
//
// This used to be a blind sleep(getCarouselFooterDelayMs()) - first 2500ms,
// then bumped to 6000ms after a live test on afromarket_partner_stores_v1
// showed the footer still rendering *before* the carousel despite the
// 2500ms delay already firing correctly server-side. Neither delay was a
// guarantee, just a longer guess. waitForCarouselDelivery() (see
// messageStatusWaiter.js) replaces the guess with WhatsApp's own
// delivery-status webhook for that specific message: the footer send now
// blocks until Meta actually reports the carousel/card message as
// sent/delivered, or until getCarouselFooterDelayMs() elapses with no
// status webhook at all - this value is now purely that upper-bound
// fallback (client not configured, status webhook lost/delayed, or a test
// double that doesn't return a real WhatsApp message id), not the
// steady-state wait time.
//
// Reused (not a second delay/env var) for the vertical cards fallback
// further below too: each item card also carries an image
// (`image: item.image`), so the same race applies there for the same
// reason, just waiting on the last item's message id instead of the
// carousel's.
//
// Inbound messages are processed one at a time by QueueManager's single
// drain loop (see whatsappHandler.js/queueManager.js), so a fallback-path
// wait stalls every other pending message for its duration - read fresh
// (not cached at require-time) so it can be tuned or set to 0 per
// environment without a code change, matching the
// LAUDRY_OPEN_HOUR/LAUDRY_CLOSE_HOUR convention in laundryFlowPlugin.js.
function getCarouselFooterDelayMs() {
  const raw = process.env.CAROUSEL_FOOTER_DELAY_MS;
  if (!raw) return 6000;

  // A malformed value (e.g. an accidental "6000ms" unit suffix, or
  // whitespace, in a Railway env var) must never silently become NaN -
  // setTimeout(fn, NaN) behaves like setTimeout(fn, 0), which would
  // silently disable the very race-condition guard this delay exists for.
  // Falls back to the default rather than defaulting to "off".
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 6000;
}

// CONFIG_ENV is already set per Railway environment (see appConfig.js) -
// reused here so flow content/buttons can differ between dev and production
// (e.g. hiding not-yet-real partner listings on prod) without any new
// environment variable.
function isProductionEnv() {
  return String(process.env.CONFIG_ENV || process.env.NODE_ENV || 'dev').toLowerCase() === 'production';
}

// Buttons can carry `"hideInProd": true` to only render outside production -
// filtered here rather than left for the WhatsApp client, which ignores
// unknown fields and would otherwise send them straight through.
function filterEnvGatedButtons(buttons) {
  if (!Array.isArray(buttons)) return buttons;
  if (!isProductionEnv()) return buttons;
  return buttons.filter((button) => !(button && button.hideInProd));
}

// Same idea as filterEnvGatedButtons, but for 'list' state rows: a row can
// carry "hideInProd": true, and a section left with no rows after filtering
// is dropped too so production never shows an empty section header.
function filterEnvGatedSections(sections) {
  if (!Array.isArray(sections)) return sections;
  if (!isProductionEnv()) return sections;
  return sections
    .map((section) => {
      if (!section || !Array.isArray(section.rows)) return section;
      return { ...section, rows: section.rows.filter((row) => !(row && row.hideInProd)) };
    })
    .filter((section) => !section || !Array.isArray(section.rows) || section.rows.length > 0);
}

function normalizeInbound(message) {
  const text = message?.text?.body;
  if (typeof text === 'string' && text.trim()) {
    return { type: 'text', text: text.trim() };
  }

  // WhatsApp Cloud API: interactive replies (buttons/lists)
  const interactive = message?.interactive;
  const interactiveButtonId = interactive?.button_reply?.id;
  if (typeof interactiveButtonId === 'string' && interactiveButtonId.trim()) {
    return { type: 'text', text: interactiveButtonId.trim() };
  }

  const interactiveListId = interactive?.list_reply?.id;
  if (typeof interactiveListId === 'string' && interactiveListId.trim()) {
    return { type: 'text', text: interactiveListId.trim() };
  }

  // Some providers send button payloads in message.button
  const buttonPayload = message?.button?.payload;
  if (typeof buttonPayload === 'string' && buttonPayload.trim()) {
    return { type: 'text', text: buttonPayload.trim() };
  }

  const buttonText = message?.button?.text;
  if (typeof buttonText === 'string' && buttonText.trim()) {
    return { type: 'text', text: buttonText.trim() };
  }

  return { type: 'unknown', text: '' };
}

function isResetText(text) {
  return /^(hi|hello|salut|bonjour|reset|cancel|menu|back)$/i.test(String(text || '').trim());
}

function validateFlowConfig(botConfig) {
  const flows = botConfig && botConfig.flows ? botConfig.flows : {};
  if (typeof flows !== 'object' || Array.isArray(flows)) {
    throw new Error('bot config flows must be an object');
  }

  for (const [flowId, flow] of Object.entries(flows)) {
    if (!flow || typeof flow !== 'object') {
      throw new Error(`flow ${flowId} must be an object`);
    }
    if (!Array.isArray(flow.states) || flow.states.length === 0) {
      throw new Error(`flow ${flowId} must have non-empty states[]`);
    }

    const stateIds = new Set(flow.states.map((s) => s && s.id));
    if (stateIds.has(undefined) || stateIds.has(null) || stateIds.has('')) {
      throw new Error(`flow ${flowId} has a state with missing id`);
    }

    for (const state of flow.states) {
      if (state.type === 'image' && (typeof state.link !== 'string' || !state.link.trim())) {
        throw new Error(`flow ${flowId} state ${state.id}: image state requires a non-empty link`);
      }

      if (state.type === 'cards') {
        if (!Array.isArray(state.items) || state.items.length === 0) {
          throw new Error(`flow ${flowId} state ${state.id}: cards state requires a non-empty items[]`);
        }
        for (const item of state.items) {
          if (!item || typeof item.image !== 'string' || !item.image.trim()) {
            throw new Error(`flow ${flowId} state ${state.id}: every card item requires a non-empty image`);
          }
          if (typeof item.caption !== 'string' || !item.caption.trim()) {
            throw new Error(`flow ${flowId} state ${state.id}: every card item requires a non-empty caption`);
          }
          // Each card is either a quick-reply button (routes back into the
          // flow, e.g. "Get this recipe") or a CTA-URL button (opens an
          // external link, e.g. "Visit Website") - never both, never neither.
          const hasQuickReply = Boolean(item.buttonId);
          const hasUrlButton = Boolean(item.buttonUrl);
          if (hasQuickReply === hasUrlButton) {
            throw new Error(
              `flow ${flowId} state ${state.id}: every card item requires exactly one of buttonId or buttonUrl`
            );
          }
          if (hasUrlButton && typeof item.buttonUrl !== 'string') {
            throw new Error(`flow ${flowId} state ${state.id}: card item buttonUrl must be a string`);
          }
        }

        if (state.carouselTemplate) {
          const ct = state.carouselTemplate;
          if (typeof ct.templateName !== 'string' || !ct.templateName.trim()) {
            throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate requires a non-empty templateName`);
          }
          if (!Array.isArray(ct.cards) || ct.cards.length === 0) {
            throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate requires a non-empty cards[]`);
          }
          // Meta requires 2-10 cards per carousel template; outside that range
          // every live send would fail and silently fall back to vertical
          // cards, masking a config error as a permanent runtime degradation.
          if (ct.cards.length < 2 || ct.cards.length > 10) {
            throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate.cards must have between 2 and 10 cards`);
          }
          // Meta requires every card in a carousel to have the same button
          // combination (type and count) - never a quick_reply on one card
          // and a URL button on another within the same template.
          const buttonTypes = new Set(ct.cards.map((card) => (card && card.buttonType === 'url' ? 'url' : 'quick_reply')));
          if (buttonTypes.size > 1) {
            throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate cards must all use the same buttonType`);
          }
          const carouselButtonType = [...buttonTypes][0];

          const quickReplyPayloads = new Set();
          const cardUrls = new Set();
          const cardIds = new Set();
          let everyCardHasId = ct.cards.length > 0;
          for (const card of ct.cards) {
            if (!card || typeof card.imageLink !== 'string' || !card.imageLink.trim()) {
              throw new Error(`flow ${flowId} state ${state.id}: every carouselTemplate card requires a non-empty imageLink`);
            }
            if (card.bodyText != null && (typeof card.bodyText !== 'string' || !card.bodyText.trim())) {
              throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate card bodyText, when present, must be a non-empty string`);
            }
            if (carouselButtonType === 'quick_reply') {
              if (typeof card.quickReplyPayload !== 'string' || !card.quickReplyPayload.trim()) {
                throw new Error(`flow ${flowId} state ${state.id}: every carouselTemplate card requires a non-empty quickReplyPayload`);
              }
              quickReplyPayloads.add(card.quickReplyPayload);
            } else {
              if (typeof card.url !== 'string' || !card.url.trim()) {
                throw new Error(`flow ${flowId} state ${state.id}: every url-buttonType carouselTemplate card requires a non-empty url`);
              }
              cardUrls.add(card.url);
            }
            if (card.id != null) {
              if (typeof card.id !== 'string' || !card.id.trim()) {
                throw new Error(`flow ${flowId} state ${state.id}: carouselTemplate card id, when present, must be a non-empty string`);
              }
              cardIds.add(card.id.trim());
            } else {
              everyCardHasId = false;
            }
          }

          // The vertical items[] only ever renders when the carousel send
          // fails, so a drift between the two card sets would silently break
          // routing/links on that rarely-exercised fallback path. Both card
          // sets must reference the same set of values.
          //
          // Two ways to express that correspondence:
          // - By a shared `id` on every card and every item, when present -
          //   mechanism-agnostic, so the carousel can route via quick_reply
          //   (through the bot, to sidestep WhatsApp's one-base-URL-per-
          //   template limit on url buttons - see afromarket_restaurants_v2)
          //   while the vertical fallback keeps sending direct cta_url links,
          //   without forcing both paths onto the same button type.
          // - Otherwise, by matching buttonId/buttonUrl directly against the
          //   carousel's own quickReplyPayload/url values (the original
          //   check) - both sides must use the same mechanism for this to
          //   mean anything, which is still true for every carouselTemplate
          //   state that hasn't opted into per-card `id`s (e.g. Partner
          //   Stores).
          // Validated and trimmed the same way as cardIds above (a
          // non-string or whitespace-only id would otherwise silently
          // disable this check rather than fail loudly).
          const itemIds = new Set();
          let everyItemHasId = state.items.length > 0;
          for (const item of state.items) {
            if (item.id != null) {
              if (typeof item.id !== 'string' || !item.id.trim()) {
                throw new Error(`flow ${flowId} state ${state.id}: items[].id, when present, must be a non-empty string`);
              }
              itemIds.add(item.id.trim());
            } else {
              everyItemHasId = false;
            }
          }
          const setsMatch =
            everyCardHasId && everyItemHasId
              ? cardIds.size === itemIds.size && [...cardIds].every((id) => itemIds.has(id))
              : carouselButtonType === 'quick_reply'
                ? (() => {
                    const itemButtonIds = new Set(state.items.filter((item) => item.buttonId).map((item) => item.buttonId));
                    return (
                      quickReplyPayloads.size === itemButtonIds.size &&
                      [...quickReplyPayloads].every((payload) => itemButtonIds.has(payload))
                    );
                  })()
                : (() => {
                    const itemButtonUrls = new Set(state.items.filter((item) => item.buttonUrl).map((item) => item.buttonUrl));
                    return cardUrls.size === itemButtonUrls.size && [...cardUrls].every((url) => itemButtonUrls.has(url));
                  })();
          if (!setsMatch) {
            const fieldName =
              everyCardHasId && everyItemHasId
                ? 'id values must exactly match items[].id'
                : carouselButtonType === 'quick_reply'
                  ? 'quickReplyPayload values must exactly match items[].buttonId'
                  : 'url values must exactly match items[].buttonUrl';
            throw new Error(
              `flow ${flowId} state ${state.id}: carouselTemplate ${fieldName} values (fallback routing would drift otherwise)`
            );
          }
        }
      }

      if (state.type !== 'action' || state.action !== 'route') continue;

      const params = state.params || {};
      if (typeof params.from !== 'string' || !params.from.trim()) {
        throw new Error(`flow ${flowId} state ${state.id}: route action requires params.from`);
      }

      // Without a default or a next, an unmatched input would leave the
      // conversation stuck on the action state forever.
      if (!params.default && !state.next) {
        throw new Error(`flow ${flowId} state ${state.id}: route action requires params.default or next`);
      }
    }
  }
}

class FlowEngine {
  constructor({ botConfig, plugin } = {}) {
    this.botConfig = botConfig;
    this.plugin = plugin || null;
    validateFlowConfig(botConfig);
  }

  selectFlowId({ inbound, state }) {
    const flows = this.botConfig.flows || {};

    // 1) If already in a flow, keep it
    if (state && state.currentFlowId && flows[state.currentFlowId]) return state.currentFlowId;

    // 2) Reset text routes to default
    if (inbound && inbound.type === 'text' && isResetText(inbound.text)) {
      if (this.botConfig.defaultFlowId && flows[this.botConfig.defaultFlowId]) return this.botConfig.defaultFlowId;
      if (flows.main_menu) return 'main_menu';
    }

    // 3) Trigger-based match
    const text = inbound && inbound.type === 'text' ? inbound.text.toLowerCase() : '';
    for (const [flowId, flow] of Object.entries(flows)) {
      const triggers = Array.isArray(flow.triggers) ? flow.triggers : [];
      for (const trig of triggers) {
        if (typeof trig !== 'string' || !trig.trim()) continue;
        if (text === trig.toLowerCase()) return flowId;
      }
    }

    // 4) Fallback to default
    if (this.botConfig.defaultFlowId && flows[this.botConfig.defaultFlowId]) return this.botConfig.defaultFlowId;
    const first = Object.keys(flows)[0];
    return first || null;
  }

  getStateDef(flowId, stateId) {
    const flow = (this.botConfig.flows || {})[flowId];
    if (!flow) return null;
    return flow.states.find((s) => s.id === stateId) || null;
  }

  getInitialStateId(flowId) {
    const flow = (this.botConfig.flows || {})[flowId];
    if (!flow) return null;
    if (flow.initialStateId) return flow.initialStateId;
    return flow.states[0].id;
  }

  // Shared template context for every renderTemplate() call - `env.isProduction`
  // lets a template branch on environment via Mustache sections
  // (`{{#env.isProduction}}...{{/env.isProduction}}` for production-only text,
  // `{{^env.isProduction}}...{{/env.isProduction}}` for everywhere else)
  // without any new per-environment config.
  //
  // `phone` is the real WhatsApp phone number if the sender has one, `null`
  // otherwise - NOT the same as `from` (the routing identifier, which may be
  // a BSUID once WhatsApp usernames are in play; see
  // afromarket-bsuid-codebase-readiness-agent-instructions.md). Templates
  // that render {{user.phone}} would otherwise show a raw BSUID string to a
  // customer who has no phone number on the interaction at all.
  buildTemplateContext(from, phone) {
    return {
      user: { phone: phone || '' },
      bot: { name: this.botConfig.botName },
      env: { isProduction: isProductionEnv() }
    };
  }

  async step({ from, message, phone, state, send }) {
    const inboundMessage = normalizeInbound(message);
    const conversationState = state || { currentFlowId: null, currentStateId: null, context: {} };

    const previousFlowId = conversationState.currentFlowId;
    const selectedFlowId = this.selectFlowId({ inbound: inboundMessage, state: conversationState });
    if (!selectedFlowId) {
      return { state: conversationState, intents: [] };
    }

    const didEnterOrSwitchFlow = !previousFlowId || previousFlowId !== selectedFlowId;

    if (!conversationState.currentFlowId || conversationState.currentFlowId !== selectedFlowId) {
      conversationState.currentFlowId = selectedFlowId;
      conversationState.currentStateId = this.getInitialStateId(selectedFlowId);
    }

    // When we (re)enter a flow due to a trigger/reset/default, we don't want the same inbound text
    // (e.g., "hi", "menu") to be treated as the first menu selection.
    let hasConsumedInboundText = didEnterOrSwitchFlow && inboundMessage.type === 'text';
    const outboundIntents = [];
    const sentImageStateIds = new Set();

    const flowContext = {
      from,
      // The real WhatsApp phone number, or null - see buildTemplateContext's
      // comment. Plugins must use this (not `from`) wherever they actually
      // need a phone-shaped value; `from` is only a routing identifier.
      phone: phone || null,
      inbound: inboundMessage,
      bot: this.botConfig,
      get flowId() {
        return conversationState.currentFlowId;
      },
      get stateId() {
        return conversationState.currentStateId;
      },
      get context() {
        return conversationState.context || {};
      },
      set: (key, value) => {
        conversationState.context = conversationState.context || {};
        conversationState.context[key] = value;
      },
      get: (key) => (conversationState.context || {})[key],
      goto: (nextStateId) => {
        conversationState.currentStateId = nextStateId;
        flowContext._didGoto = true;
      },
      send
    };

    if (this.plugin && this.plugin.beforeHandleMessage) {
      await this.plugin.beforeHandleMessage(flowContext);
    }

    // Execute a chain of input/action states until we send a message or need input.
    // This prevents consuming the same inbound text as both trigger and subsequent menu choice.
    for (let safetyStepIndex = 0; safetyStepIndex < 20; safetyStepIndex += 1) {
      const stateDefinition = this.getStateDef(conversationState.currentFlowId, conversationState.currentStateId);
      if (!stateDefinition) {
        conversationState.currentStateId = this.getInitialStateId(conversationState.currentFlowId);
        continue;
      }

      if (this.plugin && this.plugin.beforeState) {
        await this.plugin.beforeState(flowContext);
      }

      if (stateDefinition.type === 'message') {
        const body = renderTemplate(stateDefinition.template || '', {
          ...flowContext.context,
          ...this.buildTemplateContext(from, phone)
        });

        const outboundIntent = { type: 'text', to: from, body };
        outboundIntents.push(outboundIntent);
        if (typeof send === 'function') {
          await send(outboundIntent);
        }

        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        // Stop after sending a message.
        break;
      }

      if (stateDefinition.type === 'image') {
        // Image states continue the chain, so guard against config cycles that
        // would otherwise fire real media sends until the safety cap.
        if (sentImageStateIds.has(stateDefinition.id)) {
          break;
        }
        sentImageStateIds.add(stateDefinition.id);

        const templateContext = {
          ...flowContext.context,
          ...this.buildTemplateContext(from, phone)
        };
        const link = renderTemplate(stateDefinition.link || '', templateContext);
        const caption = renderTemplate(stateDefinition.caption || '', templateContext);

        // When the very next state is a 'buttons' menu, fold the image straight
        // into that message (image header + combined body + its buttons)
        // instead of sending two separate messages. WhatsApp clients don't
        // guarantee display order between two rapid sequential sends - the
        // heavier image message can visibly render after the lighter
        // buttons-only message sent right behind it, so a customer could see
        // "Bon appétit, want to explore more?" before the recipe/product it's
        // about. A single interactive image+buttons message can't reorder
        // relative to itself.
        const nextStateDefinition = stateDefinition.next
          ? this.getStateDef(conversationState.currentFlowId, stateDefinition.next)
          : null;

        if (nextStateDefinition && nextStateDefinition.type === 'buttons') {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;

          if (this.plugin && this.plugin.beforeState) {
            await this.plugin.beforeState(flowContext);
          }

          const menuTemplateContext = {
            ...flowContext.context,
            ...this.buildTemplateContext(from, phone)
          };
          const menuBody = renderTemplate(nextStateDefinition.template || nextStateDefinition.body || '', menuTemplateContext);
          const combinedBody = [caption, menuBody].filter((part) => part && part.trim()).join('\n\n');

          let buttons = [];
          if (Array.isArray(nextStateDefinition.buttons)) {
            buttons = nextStateDefinition.buttons;
          } else if (
            typeof nextStateDefinition.buttonsFromContext === 'string' &&
            nextStateDefinition.buttonsFromContext.trim()
          ) {
            const fromContextButtons = flowContext.get(nextStateDefinition.buttonsFromContext);
            buttons = Array.isArray(fromContextButtons) ? fromContextButtons : [];
          }
          buttons = filterEnvGatedButtons(buttons);

          const outboundIntent = { type: 'buttons', to: from, body: combinedBody, buttons, image: link };
          outboundIntents.push(outboundIntent);
          if (typeof send === 'function') {
            await send(outboundIntent);
          }

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }

          break;
        }

        const outboundIntent = { type: 'image', to: from, link, caption };
        outboundIntents.push(outboundIntent);
        if (typeof send === 'function') {
          await send(outboundIntent);
        }

        // Unlike 'message', an image state with a next continues the chain so a
        // follow-up menu (buttons/list) can be rendered in the same turn.
        let didAdvance = false;
        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
          didAdvance = true;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        if (didAdvance) {
          continue;
        }
        break;
      }

      if (stateDefinition.type === 'buttons') {
        // Behaves like an input state, but sends interactive reply buttons.
        if (inboundMessage.type !== 'text' || hasConsumedInboundText) {
          const body = renderTemplate(stateDefinition.template || stateDefinition.body || '', {
            ...flowContext.context,
            ...this.buildTemplateContext(from, phone)
          });

          let buttons = [];
          if (Array.isArray(stateDefinition.buttons)) {
            buttons = stateDefinition.buttons;
          } else if (typeof stateDefinition.buttonsFromContext === 'string' && stateDefinition.buttonsFromContext.trim()) {
            const fromContextButtons = flowContext.get(stateDefinition.buttonsFromContext);
            buttons = Array.isArray(fromContextButtons) ? fromContextButtons : [];
          }
          buttons = filterEnvGatedButtons(buttons);

          const outboundIntent = { type: 'buttons', to: from, body, buttons };
          if (typeof stateDefinition.image === 'string' && stateDefinition.image.trim()) {
            outboundIntent.image = stateDefinition.image;
          }
          outboundIntents.push(outboundIntent);
          if (typeof send === 'function') await send(outboundIntent);

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }
          break;
        }

        hasConsumedInboundText = true;
        if (stateDefinition.saveAs) {
          conversationState.context = conversationState.context || {};
          conversationState.context[stateDefinition.saveAs] = inboundMessage.text;
        }

        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        continue;
      }

      if (stateDefinition.type === 'list') {
        // Behaves like an input state, but sends an interactive list.
        if (inboundMessage.type !== 'text' || hasConsumedInboundText) {
          const body = renderTemplate(stateDefinition.template || stateDefinition.body || '', {
            ...flowContext.context,
            ...this.buildTemplateContext(from, phone)
          });

          const buttonText =
            (typeof stateDefinition.buttonTextFromContext === 'string' && stateDefinition.buttonTextFromContext.trim()
              ? flowContext.get(stateDefinition.buttonTextFromContext)
              : stateDefinition.buttonText) ||
            'Select';

          let sections = [];
          if (Array.isArray(stateDefinition.sections)) {
            sections = stateDefinition.sections;
          } else if (typeof stateDefinition.sectionsFromContext === 'string' && stateDefinition.sectionsFromContext.trim()) {
            const fromContextSections = flowContext.get(stateDefinition.sectionsFromContext);
            sections = Array.isArray(fromContextSections) ? fromContextSections : [];
          }

          sections = filterEnvGatedSections(sections);

          const outboundIntent = {
            type: 'list',
            to: from,
            body,
            buttonText: typeof buttonText === 'string' ? buttonText : 'Select',
            sections
          };
          outboundIntents.push(outboundIntent);
          if (typeof send === 'function') await send(outboundIntent);

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }
          break;
        }

        hasConsumedInboundText = true;
        if (stateDefinition.saveAs) {
          conversationState.context = conversationState.context || {};
          conversationState.context[stateDefinition.saveAs] = inboundMessage.text;
        }

        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        continue;
      }

      if (stateDefinition.type === 'cards') {
        // Fans a visual "pick one" prompt out across several WhatsApp
        // messages (one image+button per item, since list message headers
        // are text-only and can't carry per-row photos), then gates on the
        // reply exactly like 'list' does.
        if (inboundMessage.type !== 'text' || hasConsumedInboundText) {
          const templateContext = {
            ...flowContext.context,
            ...this.buildTemplateContext(from, phone)
          };

          // A single 'cards' render fans out into several independent WhatsApp
          // sends. Unlike every other state type (one message, one send), a
          // failure partway through must not throw out of step() uncaught -
          // that would skip the Redis persist in ConfigBot.handleMessage and
          // strand the conversation on its *previous* state while the user
          // may already have received some of these cards. So each send is
          // isolated: log and keep going, so the rest of the cards and the
          // footer (with its way back to the menu) still reach the user.
          const trySend = async (intent) => {
            outboundIntents.push(intent);
            if (typeof send !== 'function') return null;
            try {
              return await send(intent);
            } catch (err) {
              logger.warn('cards state: failed to send one message, continuing with the rest', {
                stateId: stateDefinition.id,
                intentType: intent.type,
                error: err && err.message ? err.message : String(err)
              });
              return null;
            }
          };

          // A carouselTemplate (a real, Meta-approved WhatsApp Carousel Template)
          // replaces the whole intro+items+footer fan-out with a single native
          // horizontal-scroll message when present. Unlike the items below, a
          // failed send here is NOT swallowed by trySend - it falls through to
          // the vertical items fan-out as a genuine fallback, so a template
          // outage never leaves the customer with nothing.
          let carouselSent = false;
          let carouselMessageId = null;
          if (stateDefinition.carouselTemplate) {
            const ct = stateDefinition.carouselTemplate;
            const carouselIntent = {
              type: 'template_carousel',
              to: from,
              templateName: ct.templateName,
              languageCode: ct.languageCode,
              bodyParams: ct.bodyParams,
              cards: ct.cards
            };
            try {
              outboundIntents.push(carouselIntent);
              const sendResult = typeof send === 'function' ? await send(carouselIntent) : null;
              carouselSent = true;
              carouselMessageId = extractMessageId(sendResult);
            } catch (err) {
              outboundIntents.pop();
              // error, not warn: a template that keeps failing (bad name,
              // disapproved, throttled WABA) degrades permanently and
              // invisibly to the vertical fallback with no other signal -
              // this line is the only thing that would surface it.
              logger.error('cards state: carousel template send failed, falling back to vertical cards', {
                stateId: stateDefinition.id,
                templateName: ct.templateName,
                to: from,
                error: err && err.message ? err.message : String(err)
              });
            }
          }

          if (carouselSent) {
            if (Array.isArray(stateDefinition.footerButtons) && stateDefinition.footerButtons.length) {
              // Blocks on WhatsApp's own delivery-status webhook for the
              // carousel message (falling back to getCarouselFooterDelayMs()
              // if none arrives in time) instead of a blind sleep - see
              // messageStatusWaiter.js. This is what actually fixes the
              // footer-before-carousel race a fixed delay kept losing.
              await waitForCarouselDelivery(carouselMessageId, getCarouselFooterDelayMs());
              await trySend({
                type: 'buttons',
                to: from,
                body: stateDefinition.footerText ? renderTemplate(stateDefinition.footerText, templateContext) : 'More options:',
                buttons: stateDefinition.footerButtons
              });
            }

            if (this.plugin && this.plugin.afterState) {
              await this.plugin.afterState(flowContext);
            }
            break;
          }

          if (stateDefinition.intro) {
            await trySend({ type: 'text', to: from, body: renderTemplate(stateDefinition.intro, templateContext) });
          }

          const items = Array.isArray(stateDefinition.items) ? stateDefinition.items : [];
          let lastItemMessageId = null;
          for (const item of items) {
            const body = renderTemplate(item.caption || '', templateContext);
            if (item.buttonUrl) {
              // eslint-disable-next-line no-await-in-loop
              const sendResult = await trySend({
                type: 'cta_url',
                to: from,
                body,
                image: item.image,
                buttonText: item.buttonTitle || 'Open link',
                url: renderTemplate(item.buttonUrl, templateContext)
              });
              lastItemMessageId = extractMessageId(sendResult) || lastItemMessageId;
              continue;
            }
            // eslint-disable-next-line no-await-in-loop
            const sendResult = await trySend({
              type: 'buttons',
              to: from,
              body,
              buttons: [{ id: item.buttonId, title: item.buttonTitle || 'View' }],
              image: item.image
            });
            lastItemMessageId = extractMessageId(sendResult) || lastItemMessageId;
          }

          if (Array.isArray(stateDefinition.footerButtons) && stateDefinition.footerButtons.length) {
            // Same image-send race the carousel path guards against above,
            // and the same delivery-status-webhook fix - wait on the last
            // item's message id (the one immediately ahead of the footer)
            // rather than a fixed delay. Deliberately only the last one:
            // earlier items' own status webhooks may arrive and be dropped
            // as no-ops (see messageStatusWaiter.notify) while this loop is
            // still sending later items, since nothing is waiting on them
            // yet - that's fine, only the send immediately before the
            // footer needs to be caught. The registration-timing gap this
            // relies on (send() resolving, then this line registering the
            // waiter) is a same-tick microtask hop; a live network status
            // webhook (tens of ms at best) can't realistically win that
            // race, so the wait almost always finds a waiter already
            // registered when it arrives. Unconditional here (not "only if
            // an item had an image"): validateFlowConfig requires every
            // 'cards' state to have a non-empty items[] where every item
            // carries a non-empty image, so by the time a stateDefinition
            // reaches this code, at least one image-bearing send has always
            // already gone out ahead of this footer.
            await waitForCarouselDelivery(lastItemMessageId, getCarouselFooterDelayMs());
            await trySend({
              type: 'buttons',
              to: from,
              body: stateDefinition.footerText ? renderTemplate(stateDefinition.footerText, templateContext) : 'More options:',
              buttons: stateDefinition.footerButtons
            });
          }

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }
          break;
        }

        hasConsumedInboundText = true;
        if (stateDefinition.saveAs) {
          conversationState.context = conversationState.context || {};
          conversationState.context[stateDefinition.saveAs] = inboundMessage.text;
        }

        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        continue;
      }

      if (stateDefinition.type === 'input') {
        if (inboundMessage.type !== 'text' || hasConsumedInboundText) {
          const body = renderTemplate(stateDefinition.prompt || 'Please enter a value.', {
            ...flowContext.context,
            ...this.buildTemplateContext(from, phone)
          });
          const outboundIntent = { type: 'text', to: from, body };
          outboundIntents.push(outboundIntent);
          if (typeof send === 'function') await send(outboundIntent);

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }
          break;
        }

        hasConsumedInboundText = true;
        if (stateDefinition.saveAs) {
          conversationState.context = conversationState.context || {};
          conversationState.context[stateDefinition.saveAs] = inboundMessage.text;
        }

        if (stateDefinition.next) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        continue;
      }

      if (stateDefinition.type === 'action') {
        const action = stateDefinition.action;
        const params = stateDefinition.params || {};
        flowContext._didGoto = false;

        let handled = false;
        if (this.plugin && this.plugin.handleAction) {
          handled = await this.plugin.handleAction(flowContext, { action, params });
        }

        if (!handled) {
          if (action === 'set') {
            for (const [key, value] of Object.entries(params)) {
              conversationState.context = conversationState.context || {};
              conversationState.context[key] = value;
            }
            handled = true;
          }

          if (action === 'route') {
            const routeValue = String(flowContext.get(params.from) ?? '').trim().toLowerCase();
            const routeMap = params.map && typeof params.map === 'object' && !Array.isArray(params.map) ? params.map : {};

            let targetStateId = null;
            for (const [candidate, stateId] of Object.entries(routeMap)) {
              if (String(candidate).trim().toLowerCase() === routeValue) {
                targetStateId = stateId;
                break;
              }
            }

            if (!targetStateId && params.default) {
              targetStateId = params.default;
            }

            if (targetStateId) {
              flowContext.goto(targetStateId);
            }
            handled = true;
          }
        }

        if (!handled) {
          const outboundIntent = { type: 'text', to: from, body: 'Action not implemented.' };
          outboundIntents.push(outboundIntent);
          if (typeof send === 'function') await send(outboundIntent);

          if (this.plugin && this.plugin.afterState) {
            await this.plugin.afterState(flowContext);
          }
          break;
        }

        if (stateDefinition.next && !flowContext._didGoto) {
          if (this.plugin && this.plugin.beforeTransition) {
            await this.plugin.beforeTransition(flowContext, { to: stateDefinition.next });
          }
          conversationState.currentStateId = stateDefinition.next;
        }

        if (this.plugin && this.plugin.afterState) {
          await this.plugin.afterState(flowContext);
        }

        // An action that neither transitioned nor has a next would loop on
        // itself until the safety cap; stop the turn instead.
        if (!flowContext._didGoto && !stateDefinition.next) {
          break;
        }

        continue;
      }

      const outboundIntent = { type: 'text', to: from, body: 'Unsupported state type.' };
      outboundIntents.push(outboundIntent);
      if (typeof send === 'function') await send(outboundIntent);
      break;
    }

    return { state: conversationState, intents: outboundIntents };
  }
}

module.exports = { FlowEngine, validateFlowConfig, getCarouselFooterDelayMs };
