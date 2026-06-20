package com.botmanager.core.flow;

import com.botmanager.core.bot.BotConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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

    private static class TestMessageSender implements MessageSender {

        private final List<String> sentMessages = new java.util.ArrayList<>();

        @Override
        public void sendText(String to, String body) {
            sentMessages.add(body);
        }

        @Override
        public void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons) {
            sentMessages.add(body);
        }

        public List<String> getSentMessages() {
            return sentMessages;
        }
    }

}
