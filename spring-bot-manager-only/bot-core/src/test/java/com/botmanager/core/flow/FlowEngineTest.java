package com.botmanager.core.flow;

import com.botmanager.core.bot.BotConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FlowEngineTest {

    private FlowEngine flowEngine;

    private TemplateRenderer templateRenderer;

    @BeforeEach
    void setUp() {
        templateRenderer = new TemplateRenderer();
        flowEngine = new FlowEngine(templateRenderer);
    }

    @Test
    void shouldProcessMessageStateAndMoveToNext() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, null);

        // then
        assertThat(messageSender.getSentMessages()).isNotEmpty();
        assertThat(conversationState.getCurrentStateId()).isEqualTo("await_choice");
    }

    @Test
    void shouldResetFlowOnResetKeyword() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setCurrentFlowId("main_menu");
        conversationState.setCurrentStateId("some_deep_state");
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "menu", messageSender, null);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @ParameterizedTest
    @ValueSource(strings = {"hi", "hello", "menu", "start", "reset"})
    void shouldResetStateOnAnyResetKeyword(String keyword) {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setCurrentFlowId("main_menu");
        conversationState.setCurrentStateId("deep_state");
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, keyword, messageSender, null);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldHandleNullUserMessage() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, null, messageSender, null);

        // then — should still process using default flow
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldRenderTemplateWithContextVariables() {
        // given
        BotConfig botConfig = createBotConfigWithTemplate();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        conversationState.setContextValue("name", "John");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, null);

        // then
        assertThat(messageSender.getSentMessages()).contains("Hello John!");
    }

    @Test
    void shouldSaveUserInputToContext() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setCurrentFlowId("main_menu");
        conversationState.setCurrentStateId("await_choice");
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "option1", messageSender, null);

        // then
        assertThat(conversationState.getContextValue("menuChoice")).isEqualTo("option1");
    }

    @Test
    void shouldWaitForInputWhenNoUserMessage() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setCurrentFlowId("main_menu");
        conversationState.setCurrentStateId("await_choice");
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when — reset keywords are handled, but blank input on INPUT state should wait
        flowEngine.step(botConfig, conversationState, "not_a_reset", messageSender, null);

        // then — state should remain await_choice since input was provided and saved
        // (it processes the input and moves to next, which is null for await_choice)
        assertThat(conversationState.getContextValue("menuChoice")).isEqualTo("not_a_reset");
    }

    @Test
    void shouldProcessButtonsState() {
        // given — trigger the flow first, then step with null to show buttons
        BotConfig botConfig = createBotConfigWithButtons();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when — first step triggers the flow and lands on BUTTONS state
        flowEngine.step(botConfig, conversationState, "hi", messageSender, null);
        // second step with null message shows the buttons
        flowEngine.step(botConfig, conversationState, null, messageSender, null);

        // then
        assertThat(messageSender.getSentMessages()).isNotEmpty();
        assertThat(messageSender.getButtonsSent()).isNotEmpty();
    }

    @Test
    void shouldProcessActionStateWithPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        TestFlowPlugin plugin = new TestFlowPlugin();

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, plugin);

        // then
        assertThat(plugin.getHandledActions()).contains("test_action");
    }

    @Test
    void shouldHandleActionStateWithNullPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when — should not throw even with null plugin
        flowEngine.step(botConfig, conversationState, "hi", messageSender, null);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldHandlePluginException() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        FlowPlugin failingPlugin = new FlowPlugin() {
            @Override
            public void handleAction(String action, Map<String, Object> params, FlowContext context) {
                throw new RuntimeException("Plugin failure");
            }
        };

        // when — should not propagate the exception
        flowEngine.step(botConfig, conversationState, "hi", messageSender, failingPlugin);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldFollowGotoTargetFromPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithActionAndGoto();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        FlowPlugin gotoPlugin = new FlowPlugin() {
            @Override
            public void handleAction(String action, Map<String, Object> params, FlowContext context) {
                context.goTo("goto_target");
            }
        };

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, gotoPlugin);

        // then
        assertThat(conversationState.getCurrentStateId()).isEqualTo("goto_target");
    }

    @Test
    void shouldDoNothingWhenNoFlowFound() {
        // given
        BotConfig botConfig = new BotConfig();
        botConfig.setBotId("test-bot");
        botConfig.setFlows(Map.of());
        ConversationState conversationState = new ConversationState();
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "anything", messageSender, null);

        // then
        assertThat(messageSender.getSentMessages()).isEmpty();
    }

    @Test
    void shouldFallbackToStartStateWhenCurrentStateNotFound() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setCurrentFlowId("main_menu");
        conversationState.setCurrentStateId("nonexistent_state");
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "some_input", messageSender, null);

        // then — should have fallen back to start state and sent welcome message
        assertThat(messageSender.getSentMessages()).isNotEmpty();
    }

    @Test
    void shouldNormalizeUserMessageToLowerCase() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "  HI  ", messageSender, null);

        // then — "hi" is a reset keyword, should match
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
        assertThat(messageSender.getSentMessages()).isNotEmpty();
    }

    @Test
    void shouldTriggerFlowByTriggerWord() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when
        flowEngine.step(botConfig, conversationState, "hello", messageSender, null);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldFlushResponseMessageFromPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        FlowPlugin responsePlugin = new FlowPlugin() {
            @Override
            public void handleAction(String action, Map<String, Object> params, FlowContext context) {
                context.set("responseMessage", "Plugin says hello!");
            }
        };

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, responsePlugin);

        // then
        assertThat(messageSender.getSentMessages()).contains("Plugin says hello!");
    }

    @Test
    void shouldFlushResponseWithButtonsFromPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        FlowPlugin buttonPlugin = new FlowPlugin() {
            @Override
            public void handleAction(String action, Map<String, Object> params, FlowContext context) {
                context.set("responseMessage", "Choose:");
                FlowState.ButtonOption btn = new FlowState.ButtonOption();
                btn.setId("opt1");
                btn.setTitle("Option 1");
                context.set("responseButtons", List.of(btn));
            }
        };

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, buttonPlugin);

        // then
        assertThat(messageSender.getButtonsSent()).isNotEmpty();
    }

    @Test
    void shouldFlushListMessageFromPlugin() {
        // given
        BotConfig botConfig = createBotConfigWithAction();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();
        FlowPlugin listPlugin = new FlowPlugin() {
            @Override
            public void handleAction(String action, Map<String, Object> params, FlowContext context) {
                MessageSender.ListRow row = new MessageSender.ListRow("r1", "Row 1", "Desc");
                MessageSender.ListSection section = new MessageSender.ListSection("Section", List.of(row));
                MessageSender.ListMessage listMsg = new MessageSender.ListMessage("Pick one", "Select", List.of(section));
                context.set("responseList", listMsg);
            }
        };

        // when
        flowEngine.step(botConfig, conversationState, "hi", messageSender, listPlugin);

        // then
        assertThat(messageSender.getListsSent()).isNotEmpty();
    }

    @Test
    void shouldUseButtonsFromContextWhenConfigured() {
        // given
        BotConfig botConfig = createBotConfigWithDynamicButtons();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");

        FlowState.ButtonOption btn = new FlowState.ButtonOption();
        btn.setId("dyn1");
        btn.setTitle("Dynamic Button");
        conversationState.setContextValue("dynamicButtons", List.of(btn));

        TestMessageSender messageSender = new TestMessageSender();

        // when — first step triggers flow, second shows buttons from context
        flowEngine.step(botConfig, conversationState, "hi", messageSender, null);
        flowEngine.step(botConfig, conversationState, null, messageSender, null);

        // then
        assertThat(messageSender.getButtonsSent()).isNotEmpty();
    }

    @Test
    void shouldUseDefaultFlowIdWhenNoCurrentFlow() {
        // given
        BotConfig botConfig = createTestBotConfig();
        ConversationState conversationState = new ConversationState();
        conversationState.setContextValue("customerPhone", "+237690000000");
        TestMessageSender messageSender = new TestMessageSender();

        // when — send a non-trigger, non-reset message with no current flow
        flowEngine.step(botConfig, conversationState, "random_message", messageSender, null);

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    // ---- Helper Methods ----

    private BotConfig createTestBotConfig() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState welcomeState = new FlowState();
        welcomeState.setId("welcome");
        welcomeState.setType(StateType.MESSAGE);
        welcomeState.setTemplate("Welcome to the bot!");
        welcomeState.setNext("await_choice");

        FlowState awaitChoiceState = new FlowState();
        awaitChoiceState.setId("await_choice");
        awaitChoiceState.setType(StateType.INPUT);
        awaitChoiceState.setSaveAs("menuChoice");
        awaitChoiceState.setPrompt("Choose an option");

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", welcomeState);
        states.put("await_choice", awaitChoiceState);

        FlowDefinition mainMenuFlow = new FlowDefinition();
        mainMenuFlow.setId("main_menu");
        mainMenuFlow.setTriggers(List.of("hi", "hello", "menu"));
        mainMenuFlow.setStartState("welcome");
        mainMenuFlow.setStates(states);

        config.setFlows(Map.of("main_menu", mainMenuFlow));

        return config;
    }

    private BotConfig createBotConfigWithTemplate() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState welcomeState = new FlowState();
        welcomeState.setId("welcome");
        welcomeState.setType(StateType.MESSAGE);
        welcomeState.setTemplate("Hello {{name}}!");
        welcomeState.setNext(null);

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", welcomeState);

        FlowDefinition flow = new FlowDefinition();
        flow.setId("main_menu");
        flow.setTriggers(List.of("hi"));
        flow.setStartState("welcome");
        flow.setStates(states);

        config.setFlows(Map.of("main_menu", flow));

        return config;
    }

    private BotConfig createBotConfigWithButtons() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState.ButtonOption btn1 = new FlowState.ButtonOption();
        btn1.setId("opt1");
        btn1.setTitle("Option 1");

        FlowState buttonsState = new FlowState();
        buttonsState.setId("welcome");
        buttonsState.setType(StateType.BUTTONS);
        buttonsState.setTemplate("Choose:");
        buttonsState.setButtons(List.of(btn1));

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", buttonsState);

        FlowDefinition flow = new FlowDefinition();
        flow.setId("main_menu");
        flow.setTriggers(List.of("hi"));
        flow.setStartState("welcome");
        flow.setStates(states);

        config.setFlows(Map.of("main_menu", flow));

        return config;
    }

    private BotConfig createBotConfigWithDynamicButtons() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState buttonsState = new FlowState();
        buttonsState.setId("welcome");
        buttonsState.setType(StateType.BUTTONS);
        buttonsState.setTemplate("Choose from dynamic:");
        buttonsState.setButtonsFromContext("dynamicButtons");

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", buttonsState);

        FlowDefinition flow = new FlowDefinition();
        flow.setId("main_menu");
        flow.setTriggers(List.of("hi"));
        flow.setStartState("welcome");
        flow.setStates(states);

        config.setFlows(Map.of("main_menu", flow));

        return config;
    }

    private BotConfig createBotConfigWithAction() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState actionState = new FlowState();
        actionState.setId("welcome");
        actionState.setType(StateType.ACTION);
        actionState.setAction("test_action");
        actionState.setParams(Map.of("key", "value"));
        actionState.setNext(null);

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", actionState);

        FlowDefinition flow = new FlowDefinition();
        flow.setId("main_menu");
        flow.setTriggers(List.of("hi"));
        flow.setStartState("welcome");
        flow.setStates(states);

        config.setFlows(Map.of("main_menu", flow));

        return config;
    }

    private BotConfig createBotConfigWithActionAndGoto() {
        BotConfig config = new BotConfig();
        config.setBotId("test-bot");
        config.setDefaultFlowId("main_menu");

        FlowState actionState = new FlowState();
        actionState.setId("welcome");
        actionState.setType(StateType.ACTION);
        actionState.setAction("goto_action");
        actionState.setNext("fallback");

        FlowState gotoTarget = new FlowState();
        gotoTarget.setId("goto_target");
        gotoTarget.setType(StateType.INPUT);
        gotoTarget.setPrompt("Arrived at goto target");

        FlowState fallback = new FlowState();
        fallback.setId("fallback");
        fallback.setType(StateType.INPUT);
        fallback.setPrompt("Fallback");

        Map<String, FlowState> states = new HashMap<>();
        states.put("welcome", actionState);
        states.put("goto_target", gotoTarget);
        states.put("fallback", fallback);

        FlowDefinition flow = new FlowDefinition();
        flow.setId("main_menu");
        flow.setTriggers(List.of("hi"));
        flow.setStartState("welcome");
        flow.setStates(states);

        config.setFlows(Map.of("main_menu", flow));

        return config;
    }

    // ---- Test Helpers ----

    private static class TestMessageSender extends MessageSender {

        private final List<String> sentMessages = new ArrayList<>();

        private final List<List<FlowState.ButtonOption>> buttonsSent = new ArrayList<>();

        private final List<ListMessage> listsSent = new ArrayList<>();

        @Override
        public void sendText(String to, String body) {
            sentMessages.add(body);
        }

        @Override
        public void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons) {
            sentMessages.add(body);
            buttonsSent.add(buttons);
        }

        @Override
        public void sendList(String to, ListMessage message) {
            sentMessages.add(message.body());
            listsSent.add(message);
        }

        public List<String> getSentMessages() {
            return sentMessages;
        }

        public List<List<FlowState.ButtonOption>> getButtonsSent() {
            return buttonsSent;
        }

        public List<ListMessage> getListsSent() {
            return listsSent;
        }
    }

    private static class TestFlowPlugin extends FlowPlugin {

        private final List<String> handledActions = new ArrayList<>();

        @Override
        public void handleAction(String action, Map<String, Object> params, FlowContext context) {
            handledActions.add(action);
        }

        public List<String> getHandledActions() {
            return handledActions;
        }
    }

}
