package com.botmanager.core.flow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ConversationStateTest {

    private ConversationState conversationState;

    @BeforeEach
    void setUp() {
        conversationState = new ConversationState();
    }

    @Test
    void shouldStoreAndRetrieveContextValue() {
        // when
        conversationState.setContextValue("key1", "value1");

        // then
        assertThat(conversationState.getContextValue("key1")).isEqualTo("value1");
    }

    @Test
    void shouldReturnNullForMissingKey() {
        // when
        Object result = conversationState.getContextValue("nonexistent");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldReturnContextValueAsString() {
        // given
        conversationState.setContextValue("amount", 500);

        // when
        String result = conversationState.getContextValueAsString("amount");

        // then
        assertThat(result).isEqualTo("500");
    }

    @Test
    void shouldReturnNullWhenContextValueAsStringForMissingKey() {
        // when
        String result = conversationState.getContextValueAsString("missing");

        // then
        assertThat(result).isNull();
    }

    @Test
    void shouldOverwriteExistingContextValue() {
        // given
        conversationState.setContextValue("key", "original");

        // when
        conversationState.setContextValue("key", "updated");

        // then
        assertThat(conversationState.getContextValue("key")).isEqualTo("updated");
    }

    @Test
    void shouldInitializeWithEmptyContext() {
        // then
        assertThat(conversationState.getContext()).isNotNull();
        assertThat(conversationState.getContext()).isEmpty();
    }

    @Test
    void shouldSetAndGetCurrentFlowId() {
        // when
        conversationState.setCurrentFlowId("main_menu");

        // then
        assertThat(conversationState.getCurrentFlowId()).isEqualTo("main_menu");
    }

    @Test
    void shouldSetAndGetCurrentStateId() {
        // when
        conversationState.setCurrentStateId("welcome");

        // then
        assertThat(conversationState.getCurrentStateId()).isEqualTo("welcome");
    }

    @Test
    void shouldStoreNullContextValue() {
        // given
        conversationState.setContextValue("key", "value");

        // when
        conversationState.setContextValue("key", null);

        // then
        assertThat(conversationState.getContext()).containsKey("key");
        assertThat(conversationState.getContextValue("key")).isNull();
    }

    @Test
    void shouldReturnNullStringForNullContextValue() {
        // given
        conversationState.setContextValue("key", null);

        // when
        String result = conversationState.getContextValueAsString("key");

        // then
        assertThat(result).isNull();
    }

}
