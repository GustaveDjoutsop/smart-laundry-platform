package com.botmanager.core.flow;

import lombok.Getter;
import lombok.Setter;

import java.util.HashMap;
import java.util.Map;

@Getter
@Setter
public class ConversationState {

    private String currentFlowId;

    private String currentStateId;

    private Map<String, Object> context = new HashMap<>();

    public void setContextValue(String key, Object value) {
        context.put(key, value);
    }

    public Object getContextValue(String key) {
        return context.get(key);
    }

    public String getContextValueAsString(String key) {
        Object value = context.get(key);

        return value != null ? value.toString() : null;
    }

}
