package com.botmanager.core.flow;

import java.util.List;

public abstract class MessageSender {

    public abstract void sendText(String to, String body);

    public abstract void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons);

    public abstract void sendList(String to, ListMessage message);

    public record ListRow(String id, String title, String description) {}

    public record ListSection(String title, List<ListRow> rows) {}

    public record ListMessage(String body, String buttonText, List<ListSection> sections) {}

}
