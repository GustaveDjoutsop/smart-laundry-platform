package com.botmanager.core.whatsapp;

import com.botmanager.config.WhatsAppProperties;
import com.botmanager.core.flow.FlowState;
import com.botmanager.core.flow.MessageSender;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
public class WhatsAppClient implements MessageSender {

    private static final int MAX_RETRIES = 3;

    private static final long RETRY_DELAY_MS = 1000;

    private final String phoneNumberId;

    private final String accessToken;

    private final String baseUrl;

    private final String apiVersion;

    private final RestTemplate restTemplate;

    public WhatsAppClient(String phoneNumberId,
                          String accessToken,
                          WhatsAppProperties whatsAppProperties,
                          RestTemplate restTemplate) {

        this.phoneNumberId = phoneNumberId;
        this.accessToken = accessToken;
        this.baseUrl = whatsAppProperties.getApi().getBaseUrl();
        this.apiVersion = whatsAppProperties.getApi().getVersion();
        this.restTemplate = restTemplate;
    }

    @Override
    public void sendText(String to, String body) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("recipient_type", "individual");
        payload.put("to", to);
        payload.put("type", "text");
        payload.put("text", Map.of("body", body, "preview_url", false));

        sendMessage(payload);
    }

    @Override
    public void sendButtons(String to, String body, List<FlowState.ButtonOption> buttons) {
        List<Map<String, Object>> buttonList = new ArrayList<>();

        for (FlowState.ButtonOption button : buttons) {
            buttonList.add(Map.of(
                    "type", "reply",
                    "reply", Map.of(
                            "id", button.getId(),
                            "title", button.getTitle()
                    )
            ));
        }

        Map<String, Object> interactive = new HashMap<>();
        interactive.put("type", "button");
        interactive.put("body", Map.of("text", body));
        interactive.put("action", Map.of("buttons", buttonList));

        Map<String, Object> payload = new HashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("recipient_type", "individual");
        payload.put("to", to);
        payload.put("type", "interactive");
        payload.put("interactive", interactive);

        sendMessage(payload);
    }

    private void sendMessage(Map<String, Object> payload) {
        String url = buildUrl();
        HttpHeaders headers = createHeaders();
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);

        int attempt = 0;

        while (attempt < MAX_RETRIES) {
            attempt++;

            try {
                ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);

                if (response.getStatusCode().is2xxSuccessful()) {
                    log.debug("WhatsApp message sent successfully");

                    return;
                }

                log.warn("WhatsApp API returned status {}", response.getStatusCode());
            } catch (Exception exception) {
                log.warn("WhatsApp send attempt {} failed: {}", attempt, exception.getMessage());

                if (attempt < MAX_RETRIES) {
                    try {
                        Thread.sleep(RETRY_DELAY_MS * attempt);
                    } catch (InterruptedException interruptedException) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }

        log.error("Failed to send WhatsApp message after {} attempts", MAX_RETRIES);
    }

    private String buildUrl() {
        return baseUrl + "/" + apiVersion + "/" + phoneNumberId + "/messages";
    }

    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + accessToken);
        headers.set("Content-Type", "application/json");

        return headers;
    }

}
