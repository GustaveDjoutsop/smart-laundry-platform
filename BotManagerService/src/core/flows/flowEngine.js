const { renderTemplate } = require('./templateRenderer');
const { logger } = require('../../utils/logger');

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
          if (!item.buttonId || typeof item.buttonId !== 'string') {
            throw new Error(`flow ${flowId} state ${state.id}: every card item requires a buttonId`);
          }
          if (typeof item.caption !== 'string' || !item.caption.trim()) {
            throw new Error(`flow ${flowId} state ${state.id}: every card item requires a non-empty caption`);
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

  async step({ from, message, state, send }) {
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
          user: { phone: from },
          bot: { name: this.botConfig.botName }
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
          user: { phone: from },
          bot: { name: this.botConfig.botName }
        };
        const link = renderTemplate(stateDefinition.link || '', templateContext);
        const caption = renderTemplate(stateDefinition.caption || '', templateContext);

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
            user: { phone: from },
            bot: { name: this.botConfig.botName }
          });

          let buttons = [];
          if (Array.isArray(stateDefinition.buttons)) {
            buttons = stateDefinition.buttons;
          } else if (typeof stateDefinition.buttonsFromContext === 'string' && stateDefinition.buttonsFromContext.trim()) {
            const fromContextButtons = flowContext.get(stateDefinition.buttonsFromContext);
            buttons = Array.isArray(fromContextButtons) ? fromContextButtons : [];
          }

          const outboundIntent = { type: 'buttons', to: from, body, buttons };
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
            user: { phone: from },
            bot: { name: this.botConfig.botName }
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
            user: { phone: from },
            bot: { name: this.botConfig.botName }
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
            if (typeof send !== 'function') return;
            try {
              await send(intent);
            } catch (err) {
              logger.warn('cards state: failed to send one message, continuing with the rest', {
                stateId: stateDefinition.id,
                intentType: intent.type,
                error: err && err.message ? err.message : String(err)
              });
            }
          };

          if (stateDefinition.intro) {
            await trySend({ type: 'text', to: from, body: renderTemplate(stateDefinition.intro, templateContext) });
          }

          const items = Array.isArray(stateDefinition.items) ? stateDefinition.items : [];
          for (const item of items) {
            // eslint-disable-next-line no-await-in-loop
            await trySend({
              type: 'buttons',
              to: from,
              body: renderTemplate(item.caption || '', templateContext),
              buttons: [{ id: item.buttonId, title: item.buttonTitle || 'View' }],
              image: item.image
            });
          }

          if (Array.isArray(stateDefinition.footerButtons) && stateDefinition.footerButtons.length) {
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
          const body = renderTemplate(stateDefinition.prompt || 'Please enter a value.', flowContext.context);
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

module.exports = { FlowEngine, validateFlowConfig };
