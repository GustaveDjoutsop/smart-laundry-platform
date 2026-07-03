package com.botmanager.core.flow;

import com.botmanager.core.bot.BotConfig;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.Map;

@RequiredArgsConstructor
public class FlowContext {

    @Getter
    private final ConversationState conversationState;

    private String gotoTarget;

    /** Transient — not persisted to Redis. Set by FlowEngine before each action handler invocation. */
    @Getter
    private BotConfig botConfig;

    public void set(String key, Object value) {
        conversationState.setContextValue(key, value);
    }

    public Object get(String key) {
        return conversationState.getContextValue(key);
    }

    public String getString(String key) {
        return conversationState.getContextValueAsString(key);
    }

    public Map<String, Object> getAll() {
        return conversationState.getContext();
    }

    public void goTo(String stateId) {
        this.gotoTarget = stateId;
    }

    public String consumeGotoTarget() {
        String target = this.gotoTarget;
        this.gotoTarget = null;

        return target;
    }

    public boolean hasGotoTarget() {
        return gotoTarget != null;
    }

    public void setBotConfig(BotConfig botConfig) {
        this.botConfig = botConfig;
    }

}
