package com.botmanager.core.flow;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FlowPluginTest {

    private FlowContext flowContext;

    private TestPlugin plugin;

    @BeforeEach
    void setUp() {
        ConversationState state = new ConversationState();
        flowContext = new FlowContext(state);
        plugin = new TestPlugin();
    }

    @Test
    void shouldSetContextViaHelper() {
        // when
        plugin.doSetContext(flowContext, "key", "value");

        // then
        assertThat(flowContext.get("key")).isEqualTo("value");
    }

    @Test
    void shouldGetContextViaHelper() {
        // given
        flowContext.set("key", "value");

        // when
        Object result = plugin.doGetContext(flowContext, "key");

        // then
        assertThat(result).isEqualTo("value");
    }

    @Test
    void shouldGetContextStringViaHelper() {
        // given
        flowContext.set("amount", 500);

        // when
        String result = plugin.doGetContextString(flowContext, "amount");

        // then
        assertThat(result).isEqualTo("500");
    }

    @Test
    void shouldGoToStateViaHelper() {
        // when
        plugin.doGoTo(flowContext, "target_state");

        // then
        assertThat(flowContext.hasGotoTarget()).isTrue();
        assertThat(flowContext.consumeGotoTarget()).isEqualTo("target_state");
    }

    private static class TestPlugin extends FlowPlugin {

        @Override
        public void handleAction(String action, Map<String, Object> params, FlowContext context) {
            // no-op for testing
        }

        void doSetContext(FlowContext context, String key, Object value) {
            setContext(context, key, value);
        }

        Object doGetContext(FlowContext context, String key) {
            return getContext(context, key);
        }

        String doGetContextString(FlowContext context, String key) {
            return getContextString(context, key);
        }

        void doGoTo(FlowContext context, String stateId) {
            goTo(context, stateId);
        }
    }

}
