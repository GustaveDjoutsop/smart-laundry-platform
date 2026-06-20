package com.botmanager.core.bot;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class BotRouter extends BotLookup {

    private final Map<String, BaseBot> botsByName = new ConcurrentHashMap<>();

    private final Map<String, BaseBot> botsByPhoneId = new ConcurrentHashMap<>();

    private final Map<String, String> verifyTokenToBot = new ConcurrentHashMap<>();

    public BotRouter(List<BaseBot> bots) {
        for (BaseBot bot : bots) {
            BotConfig config = bot.getConfig();
            String name = config.getBotId();

            BaseBot existing = botsByPhoneId.get(config.getPhoneNumberId());
            if (existing != null) {
                log.error(
                    "Duplicate phoneNumberId '{}' for bot '{}'. Already registered to bot '{}'. " +
                        "Webhook routing uses metadata.phone_number_id, so each bot must have a unique phoneNumberId.",
                    config.getPhoneNumberId(),
                    name,
                    existing.getConfig().getBotId()
                );
                continue;
            }

            botsByName.put(name, bot);
            botsByPhoneId.put(config.getPhoneNumberId(), bot);
            if (StringUtils.hasText(config.getVerifyToken())) {
                verifyTokenToBot.put(config.getVerifyToken(), name);
            }

            log.info("Registered bot: {} (phoneNumberId: {})", name, config.getPhoneNumberId());
        }

        log.info("Auto-registered {} bots", bots.size());
    }

    @Override
    public Optional<BaseBot> getBotByName(String name) {
        return Optional.ofNullable(botsByName.get(name));
    }

    @Override
    public Optional<BaseBot> getBotByPhoneId(String phoneNumberId) {
        return Optional.ofNullable(botsByPhoneId.get(phoneNumberId));
    }

    @Override
    public Optional<String> getBotNameByVerifyToken(String verifyToken) {
        return Optional.ofNullable(verifyTokenToBot.get(verifyToken));
    }

}
