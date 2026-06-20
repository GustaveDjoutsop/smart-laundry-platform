package com.botmanager.core.flow;

import java.util.Map;

public abstract class FlowPlugin {

    public abstract void handleAction(String action, Map<String, Object> params, FlowContext context);

    protected void goTo(FlowContext context, String stateId) {
        context.goTo(stateId);
    }

    protected void setContext(FlowContext context, String key, Object value) {
        context.set(key, value);
    }

    protected Object getContext(FlowContext context, String key) {
        return context.get(key);
    }

    protected String getContextString(FlowContext context, String key) {
        return context.getString(key);
    }

}
