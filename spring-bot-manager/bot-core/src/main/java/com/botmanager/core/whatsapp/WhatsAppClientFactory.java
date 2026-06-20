package com.botmanager.core.whatsapp;

import com.botmanager.config.WhatsAppProperties;
import com.botmanager.core.bot.BotRegistryRefreshEvent;
import com.botmanager.core.persistence.repository.BusinessRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class WhatsAppClientFactory {

    private final WhatsAppProperties whatsAppProperties;

    private final RestTemplate restTemplate;

    private final Environment environment;

    private final Map<String, WhatsAppClient> clientCache = new ConcurrentHashMap<>();

    @Autowired(required = false)
    private BusinessRepository businessRepository;

    public WhatsAppClient getClient(String botId, String phoneNumberId) {
        String cacheKey = botId + ":" + phoneNumberId;

        return clientCache.computeIfAbsent(cacheKey, key -> {
            String accessToken = getAccessToken(botId);

            if (accessToken == null) {
                log.error("No access token found for bot {}", botId);

                return null;
            }

            return new WhatsAppClient(phoneNumberId, accessToken, whatsAppProperties, restTemplate);
        });
    }

    private String getAccessToken(String botId) {
        if (businessRepository != null) {
            try {
                String token = businessRepository.findByBotId(botId)
                        .map(business -> business.getAccessToken())
                        .orElse(null);
                if (token != null && !token.isBlank()) {
                    return token;
                }
            } catch (Exception exception) {
                log.warn("Failed to resolve DB access token for bot {}: {}", botId, exception.getMessage());
            }
        }

        String envKey = "WHATSAPP_ACCESS_TOKEN_" + botId.toUpperCase().replace("-", "_");
        String token = environment.getProperty(envKey);

        if (token == null) {
            token = environment.getProperty("whatsapp.access-token." + botId);
        }

        return token;
    }

    public void clearCache() {
        clientCache.clear();
    }

    @EventListener
    public void onRefreshEvent(BotRegistryRefreshEvent event) {
        log.info("Clearing WhatsApp client cache due to bot registry refresh");
        clearCache();
    }

}
