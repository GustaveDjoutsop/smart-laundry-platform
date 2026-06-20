package com.botmanager.bots.pharmacy;

import com.botmanager.core.bot.BaseBot;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class PharmacyBot extends BaseBot {

    private final PharmacyFlowPlugin plugin;

    public PharmacyBot(PharmacyBotConfig config,
                       FlowEngine flowEngine,
                       RedisManager redisManager,
                       WhatsAppClientFactory whatsAppClientFactory,
                       ObjectMapper objectMapper,
                       PaymentGateway paymentGateway,
                       InventoryService inventoryService) {

        super(config, flowEngine, redisManager, whatsAppClientFactory, objectMapper);
        this.plugin = new PharmacyFlowPlugin(paymentGateway, inventoryService, config);

        log.info("PharmacyBot initialized: {}", config.getBotId());
    }

    @Override
    public FlowPlugin getPlugin() {
        return plugin;
    }

}
