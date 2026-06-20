package com.botmanager.bots.pharmacy;

import com.botmanager.config.BotProperties;
import com.botmanager.core.bot.BotConfigLoader;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
public class PharmacyBotConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "smartbot.bots.pharmacy", name = "enabled",
            havingValue = "true", matchIfMissing = false)
    public PharmacyBot pharmacyBot(BotProperties botProperties,
                                   FlowEngine flowEngine,
                                   RedisManager redisManager,
                                   WhatsAppClientFactory whatsAppClientFactory,
                                   ObjectMapper objectMapper,
                                   PaymentGateway paymentGateway,
                                   InventoryService inventoryService,
                                   Environment environment) {

        PharmacyBotConfig config = BotConfigLoader.load(
                botProperties.getConfigDirectory(), "pharmacy.bot.json",
                PharmacyBotConfig.class, objectMapper);

        if (config == null) {
            return null;
        }

        BotConfigLoader.resolveVerifyToken(config, environment);

        return new PharmacyBot(config, flowEngine, redisManager, whatsAppClientFactory,
                objectMapper, paymentGateway, inventoryService);
    }

}
