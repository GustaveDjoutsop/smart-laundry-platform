package com.botmanager.core;

import com.botmanager.core.bot.BotLookup;
import com.botmanager.core.persistence.MessageLogger;
import com.botmanager.core.queue.MessageJob;
import com.botmanager.core.redis.RedisManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class MessageProcessor {

    private static final long LOCK_TTL_SECONDS = 60;

    private final BotLookup botLookup;

    private final RedisManager redisManager;

    private final MessageLogger messageLogger;

    @Async("webhookExecutor")
    public void processMessage(MessageJob job) {
        String phoneNumberId = job.phoneNumberId();
        String from = job.from();
        String messageId = job.messageId();

        botLookup.getBotByPhoneId(phoneNumberId).ifPresentOrElse(
                bot -> {
                    String botId = bot.getConfig().getBotId();
                    String lockKey = "lock:" + botId + ":" + from + ":" + messageId;

                    boolean acquired = redisManager.setIfAbsent(lockKey, "1", LOCK_TTL_SECONDS);
                    if (!acquired) {
                        log.debug("Duplicate message {} from {}, skipping", messageId, from);

                        return;
                    }

                    messageLogger.logInbound(botId, from, job.messageType(), job.messageBody(), messageId);

                    try {
                        bot.handleMessage(job);
                    } catch (Exception exception) {
                        log.error("Failed to handle message {} from {}: {}",
                                messageId, from, exception.getMessage());
                    }
                },
                () -> log.warn("No bot registered for phoneNumberId: {}", phoneNumberId)
        );
    }

}
