package com.botmanager.core.flow;

import com.botmanager.core.bot.BotConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Component
@RequiredArgsConstructor
public class FlowEngine {

    private static final int MAX_ITERATIONS = 20;

    private static final Set<String> RESET_KEYWORDS = Set.of("hi", "hello", "menu", "start", "reset");

    private static final String CONTEXT_RESPONSE_MESSAGE = "responseMessage";

    private static final String CONTEXT_RESPONSE_BUTTONS = "responseButtons";

    private static final String CONTEXT_RESPONSE_LIST = "responseList";

    private final TemplateRenderer templateRenderer;

    public void step(BotConfig botConfig,
                     ConversationState conversationState,
                     String userMessage,
                     MessageSender messageSender,
                     FlowPlugin plugin) {

        FlowContext flowContext = new FlowContext(conversationState);
        String normalizedMessage = userMessage != null ? userMessage.trim().toLowerCase() : "";

        log.info("[FlowEngine] botId={} from={} msg='{}' stateId='{}' flowId='{}'",
                botConfig.getBotId(),
                conversationState.getContextValue("customerPhone"),
                normalizedMessage,
                conversationState.getCurrentStateId(),
                conversationState.getCurrentFlowId());

        FlowDefinition currentFlow = determineFlow(botConfig, conversationState, normalizedMessage);
        if (currentFlow == null) {
            log.warn("No flow found for bot {}", botConfig.getBotId());

            return;
        }

        conversationState.setCurrentFlowId(currentFlow.getId());

        String currentStateId = conversationState.getCurrentStateId();
        if (!StringUtils.hasText(currentStateId)) {
            currentStateId = currentFlow.getStartState();
        }

        int iterations = 0;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            FlowState state = currentFlow.getStates().get(currentStateId);
            if (state == null) {
                String fallback = currentFlow.getStartState();
                if (StringUtils.hasText(fallback) && currentFlow.getStates().containsKey(fallback)) {
                    log.warn("State {} not found in flow {}. Resetting to startState {}", currentStateId, currentFlow.getId(), fallback);
                    conversationState.setCurrentStateId(null);
                    currentStateId = fallback;
                    userMessage = null;
                    continue;
                }

                log.warn("State {} not found in flow {} and startState is invalid; cannot recover", currentStateId, currentFlow.getId());
                conversationState.setCurrentStateId(null);
                break;
            }

            log.debug("Processing state {} (type: {})", currentStateId, state.getType());

            String nextStateId = processState(state, flowContext, userMessage, messageSender, plugin, botConfig);

            if (flowContext.hasGotoTarget()) {
                currentStateId = flowContext.consumeGotoTarget();
                userMessage = null;
                continue;
            }

            if (nextStateId != null) {
                currentStateId = nextStateId;
                userMessage = null;
                continue;
            }

            conversationState.setCurrentStateId(currentStateId);
            break;
        }

        if (iterations >= MAX_ITERATIONS) {
            log.warn("Max iterations reached for flow {}", currentFlow.getId());
        }
    }

    private FlowDefinition determineFlow(BotConfig botConfig,
                                         ConversationState conversationState,
                                         String normalizedMessage) {

        Map<String, FlowDefinition> flows = botConfig.getFlows();

        if (RESET_KEYWORDS.contains(normalizedMessage)) {
            conversationState.setCurrentStateId(null);
            String defaultFlowId = botConfig.getDefaultFlowId();
            if (defaultFlowId != null) {
                return flows.get(defaultFlowId);
            }

            return flows.get("main_menu");
        }

        String currentFlowId = conversationState.getCurrentFlowId();
        if (StringUtils.hasText(currentFlowId) && flows.containsKey(currentFlowId)) {
            return flows.get(currentFlowId);
        }

        for (FlowDefinition flow : flows.values()) {
            if (flow.getTriggers() != null && flow.getTriggers().contains(normalizedMessage)) {
                conversationState.setCurrentStateId(null);

                return flow;
            }
        }

        String defaultFlowId = botConfig.getDefaultFlowId();
        if (defaultFlowId != null) {
            return flows.get(defaultFlowId);
        }

        return flows.values().stream().findFirst().orElse(null);
    }

    private String processState(FlowState state,
                                FlowContext flowContext,
                                String userMessage,
                                MessageSender messageSender,
                                FlowPlugin plugin,
                                BotConfig botConfig) {

        Map<String, Object> context = flowContext.getAll();
        String customerPhone = flowContext.getString("customerPhone");

        return switch (state.getType()) {
            case MESSAGE -> processMessageState(state, context, customerPhone, messageSender);
            case INPUT -> processInputState(state, flowContext, userMessage);
            case BUTTONS -> processButtonsState(state, flowContext, context, customerPhone, userMessage, messageSender);
            case ACTION -> processActionState(state, flowContext, plugin, botConfig, customerPhone, messageSender);
        };
    }

    private String processMessageState(FlowState state,
                                       Map<String, Object> context,
                                       String customerPhone,
                                       MessageSender messageSender) {

        String body = templateRenderer.render(state.getTemplate(), context);
        messageSender.sendText(customerPhone, body);

        return state.getNext();
    }

    private String processInputState(FlowState state, FlowContext flowContext, String userMessage) {
        if (!StringUtils.hasText(userMessage)) {
            String prompt = state.getPrompt();
            if (StringUtils.hasText(prompt)) {
                log.debug("Waiting for input, prompt: {}", prompt);
            }

            return null;
        }

        if (StringUtils.hasText(state.getSaveAs())) {
            flowContext.set(state.getSaveAs(), userMessage);
        }

        return state.getNext();
    }

    @SuppressWarnings("unchecked")
    private String processButtonsState(FlowState state,
                                       FlowContext flowContext,
                                       Map<String, Object> context,
                                       String customerPhone,
                                       String userMessage,
                                       MessageSender messageSender) {

        List<FlowState.ButtonOption> buttons = state.getButtons();

        if (StringUtils.hasText(state.getButtonsFromContext())) {
            Object contextButtons = context.get(state.getButtonsFromContext());
            if (contextButtons instanceof List) {
                buttons = (List<FlowState.ButtonOption>) contextButtons;
            }
        }

        if (!StringUtils.hasText(userMessage)) {
            String body = templateRenderer.render(state.getTemplate(), context);
            messageSender.sendButtons(customerPhone, body, buttons);

            return null;
        }

        if (StringUtils.hasText(state.getSaveAs())) {
            flowContext.set(state.getSaveAs(), userMessage);
        }

        return state.getNext();
    }

    private String processActionState(FlowState state,
                                      FlowContext flowContext,
                                      FlowPlugin plugin,
                                      BotConfig botConfig,
                                      String customerPhone,
                                      MessageSender messageSender) {

        if (plugin != null && StringUtils.hasText(state.getAction())) {
            Map<String, Object> params = state.getParams() != null ? state.getParams() : Map.of();
            flowContext.setBotConfig(botConfig);

            try {
                plugin.handleAction(state.getAction(), params, flowContext);
            } catch (Exception exception) {
                log.error("Action {} failed: {}", state.getAction(), exception.getMessage());
            }
        }

        try {
            flushPluginResponse(flowContext, customerPhone, messageSender);
        } catch (Exception exception) {
            log.error("Failed to send WhatsApp response for action '{}' to {}: {}",
                    state.getAction(), customerPhone, exception.getMessage());
        }

        if (flowContext.hasGotoTarget()) {
            return null;
        }

        return state.getNext();
    }

    @SuppressWarnings("unchecked")
    private void flushPluginResponse(FlowContext flowContext,
                                     String customerPhone,
                                     MessageSender messageSender) {

        if (!StringUtils.hasText(customerPhone) || messageSender == null) {
            return;
        }

        Map<String, Object> context = flowContext.getAll();

        Object responseListObj = flowContext.get(CONTEXT_RESPONSE_LIST);
        if (responseListObj instanceof MessageSender.ListMessage listMessage) {
            messageSender.sendList(customerPhone, listMessage);
            context.remove(CONTEXT_RESPONSE_LIST);
            context.remove(CONTEXT_RESPONSE_MESSAGE);
            context.remove(CONTEXT_RESPONSE_BUTTONS);
            return;
        }

        Object responseMessageObj = flowContext.get(CONTEXT_RESPONSE_MESSAGE);
        Object responseButtonsObj = flowContext.get(CONTEXT_RESPONSE_BUTTONS);

        String responseMessage = responseMessageObj != null ? responseMessageObj.toString() : null;

        List<FlowState.ButtonOption> buttons = null;
        if (responseButtonsObj instanceof List<?> list) {
            buttons = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof FlowState.ButtonOption buttonOption) {
                    buttons.add(buttonOption);
                }
            }
        }

        boolean hasButtons = buttons != null && !buttons.isEmpty();

        if (StringUtils.hasText(responseMessage)) {
            if (hasButtons) {
                messageSender.sendButtons(customerPhone, responseMessage, buttons);
            } else {
                messageSender.sendText(customerPhone, responseMessage);
            }
        }

        context.remove(CONTEXT_RESPONSE_MESSAGE);
        context.remove(CONTEXT_RESPONSE_BUTTONS);
    }

}
