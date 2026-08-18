package com.botmanager.core.bot;

import com.botmanager.core.flow.ConversationState;
import com.botmanager.core.payment.PaymentRecord;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.queue.MessageJob;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClient;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public abstract class BaseBot {

    private static final long CONVERSATION_TTL_SECONDS = 86400;

    private static final String CONVERSATION_KEY_PREFIX = "conv:";

    @Getter
    protected final BotConfig config;

    protected final FlowEngine flowEngine;

    protected final RedisManager redisManager;

    protected final WhatsAppClientFactory whatsAppClientFactory;

    protected final ObjectMapper objectMapper;

    protected BaseBot(BotConfig config,
                      FlowEngine flowEngine,
                      RedisManager redisManager,
                      WhatsAppClientFactory whatsAppClientFactory,
                      ObjectMapper objectMapper) {

        this.config = config;
        this.flowEngine = flowEngine;
        this.redisManager = redisManager;
        this.whatsAppClientFactory = whatsAppClientFactory;
        this.objectMapper = objectMapper;
    }

    public abstract FlowPlugin getPlugin();

    public void handleMessage(MessageJob job) {
        String customerPhone = job.from();
        String messageBody = job.messageBody();

        log.info("Bot {} handling message from {}", config.getBotId(), customerPhone);

        ConversationState conversationState = loadConversationState(customerPhone);
        conversationState.setContextValue("customerPhone", customerPhone);

        WhatsAppClient whatsAppClient = whatsAppClientFactory.getClient(
                config.getBotId(),
                config.getPhoneNumberId()
        );

        if (whatsAppClient == null) {
            log.error("No WhatsApp client available for bot {}", config.getBotId());

            return;
        }

        try {
            flowEngine.step(config, conversationState, messageBody, whatsAppClient, getPlugin());
        } catch (Exception exception) {
            log.error("FlowEngine.step failed for bot={} from={}: {}", config.getBotId(), customerPhone, exception.getMessage(), exception);
        }

        saveConversationState(customerPhone, conversationState);
    }

    public void sendMessage(String to, String message) {
        WhatsAppClient whatsAppClient = whatsAppClientFactory.getClient(
                config.getBotId(),
                config.getPhoneNumberId()
        );

        if (whatsAppClient != null) {
            whatsAppClient.sendText(to, message);
        }
    }

    protected ConversationState loadConversationState(String customerPhone) {
        String key = CONVERSATION_KEY_PREFIX + config.getBotId() + ":" + customerPhone;

        return redisManager.get(key, ConversationState.class)
                .orElse(new ConversationState());
    }

    protected void saveConversationState(String customerPhone, ConversationState state) {
        String key = CONVERSATION_KEY_PREFIX + config.getBotId() + ":" + customerPhone;
        log.info("[BaseBot] saving state key={} stateId='{}' flowId='{}'",
                key, state.getCurrentStateId(), state.getCurrentFlowId());
        redisManager.setWithExpiry(key, state, CONVERSATION_TTL_SECONDS);
    }

    public void onPaymentCompleted(PaymentRecord record) {
    }

    public void onPaymentFailed(PaymentRecord record) {
    }

}
