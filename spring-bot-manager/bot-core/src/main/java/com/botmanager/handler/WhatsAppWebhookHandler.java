package com.botmanager.handler;

import com.botmanager.core.MessageProcessor;
import com.botmanager.core.queue.MessageJob;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class WhatsAppWebhookHandler {

    private final MessageProcessor messageProcessor;

    private final ObjectMapper objectMapper;

    @SuppressWarnings("unchecked")
    public void handleWebhook(Map<String, Object> payload) {
        try {
            List<Map<String, Object>> entries = (List<Map<String, Object>>) payload.get("entry");
            if (entries == null) {
                return;
            }

            for (Map<String, Object> entry : entries) {
                List<Map<String, Object>> changes = (List<Map<String, Object>>) entry.get("changes");
                if (changes == null) {
                    continue;
                }

                for (Map<String, Object> change : changes) {
                    Map<String, Object> value = (Map<String, Object>) change.get("value");
                    if (value == null) {
                        continue;
                    }

                    processValue(value);
                }
            }
        } catch (Exception exception) {
            log.error("Failed to process WhatsApp webhook: {}", exception.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void processValue(Map<String, Object> value) {
        Map<String, Object> metadata = (Map<String, Object>) value.get("metadata");
        List<Map<String, Object>> messages = (List<Map<String, Object>>) value.get("messages");

        if (metadata == null || messages == null || messages.isEmpty()) {
            return;
        }

        String phoneNumberId = (String) metadata.get("phone_number_id");

        for (Map<String, Object> message : messages) {
            String from = (String) message.get("from");
            String messageId = (String) message.get("id");
            String messageType = (String) message.get("type");
            String messageBody = extractMessageBody(message, messageType);

            MessageJob job = MessageJob.builder()
                    .phoneNumberId(phoneNumberId)
                    .from(from)
                    .messageId(messageId)
                    .messageType(messageType)
                    .messageBody(messageBody)
                    .raw(message)
                    .build();

            messageProcessor.processMessage(job);

            log.debug("Enqueued message {} from {} (type: {})", messageId, from, messageType);
        }
    }

    @SuppressWarnings("unchecked")
    private String extractMessageBody(Map<String, Object> message, String messageType) {
        return switch (messageType) {
            case "text" -> {
                Map<String, Object> text = (Map<String, Object>) message.get("text");
                yield text != null ? (String) text.get("body") : null;
            }
            case "interactive" -> {
                Map<String, Object> interactive = (Map<String, Object>) message.get("interactive");
                if (interactive == null) {
                    yield null;
                }

                String interactiveType = (String) interactive.get("type");
                if ("button_reply".equals(interactiveType)) {
                    Map<String, Object> buttonReply = (Map<String, Object>) interactive.get("button_reply");
                    yield buttonReply != null ? (String) buttonReply.get("id") : null;
                }

                if ("list_reply".equals(interactiveType)) {
                    Map<String, Object> listReply = (Map<String, Object>) interactive.get("list_reply");
                    yield listReply != null ? (String) listReply.get("id") : null;
                }

                yield null;
            }
            default -> null;
        };
    }

}
