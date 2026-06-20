const { renderTemplate } = require('./templateRenderer');

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
