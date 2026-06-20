package com.botmanager.core.flow;

import java.util.List;

public interface MessageSender {

    void sendText(String to, String body);

    void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons);

}
