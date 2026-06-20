package com.botmanager.core.flow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FlowContextTest {

    private ConversationState conversationState;

    private FlowContext flowContext;

    @BeforeEach
    void setUp() {
        conversationState = new ConversationState();
        flowContext = new FlowContext(conversationState);
    }

    @Test
    void shouldSetAndGetValue() {
        // when
        flowContext.set("machineId", "W1");

        // then
        assertThat(flowContext.get("machineId")).isEqualTo("W1");
    }

    @Test
    void shouldReturnNullForMissingKey() {
        // when
        Object result = flowContext.get("nonexistent");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldGetStringValue() {
        // given
        flowContext.set("amount", 500);

        // when
        String result = flowContext.getString("amount");

        // then
        assertThat(result).isEqualTo("500");
    }

    @Test
    void shouldReturnNullStringForMissingKey() {
        // when
        String result = flowContext.getString("missing");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnAllContextValues() {
        // given
        flowContext.set("key1", "value1");
        flowContext.set("key2", "value2");

        // when
        Map<String, Object> all = flowContext.getAll();

        // then
        assertThat(all).hasSize(2);
        assertThat(all).containsEntry("key1", "value1");
        assertThat(all).containsEntry("key2", "value2");
    }

    @Test
    void shouldDelegateToConversationState() {
        // when
        flowContext.set("test", "value");

        // then
        assertThat(conversationState.getContextValue("test")).isEqualTo("value");
    }

    @Test
    void shouldReturnConversationState() {
        // then
        assertThat(flowContext.getConversationState()).isSameAs(conversationState);
    }

    @Test
    void shouldSetGotoTarget() {
        // when
        flowContext.goTo("next_state");

        // then
        assertThat(flowContext.hasGotoTarget()).isTrue();
    }

    @Test
    void shouldConsumeGotoTarget() {
        // given
        flowContext.goTo("next_state");

        // when
        String target = flowContext.consumeGotoTarget();

        // then
        assertThat(target).isEqualTo("next_state");
        assertThat(flowContext.hasGotoTarget()).isFalse();
    }

    @Test
    void shouldReturnFalseWhenNoGotoTarget() {
        // then
        assertThat(flowContext.hasGotoTarget()).isFalse();
    }

    @Test
    void shouldReturnNullWhenConsumingEmptyGotoTarget() {
        // when
        String target = flowContext.consumeGotoTarget();

        // then
        assertThat(target).isNull();
    }

    @Test
    void shouldAllowMultipleGotoOverrides() {
        // given
        flowContext.goTo("state1");
        flowContext.goTo("state2");

        // when
        String target = flowContext.consumeGotoTarget();

        // then
        assertThat(target).isEqualTo("state2");
    }

}
