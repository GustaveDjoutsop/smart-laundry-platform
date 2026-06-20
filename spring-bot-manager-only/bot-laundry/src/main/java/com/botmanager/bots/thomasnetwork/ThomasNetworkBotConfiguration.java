package com.botmanager.bots.thomasnetwork;

import com.botmanager.config.BotProperties;
import com.botmanager.core.bot.BotConfig;
import com.botmanager.core.bot.BotConfigLoader;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
public class ThomasNetworkBotConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "smartbot.bots.thomasnetwork", name = "enabled",
            havingValue = "true", matchIfMissing = true)
    public ThomasNetworkBot thomasNetworkBot(BotProperties botProperties,
                                             FlowEngine flowEngine,
                                             RedisManager redisManager,
                                             WhatsAppClientFactory whatsAppClientFactory,
                                             ObjectMapper objectMapper,
                                             PaymentGateway paymentGateway,
                                             TranslationService translationService,
                                             Environment environment) {

        BotConfig config = BotConfigLoader.load(
                botProperties.getConfigDirectory(), "thomasNetwork.bot.json",
                BotConfig.class, objectMapper);

        if (config == null) {
            return null;
        }

        BotConfigLoader.resolveVerifyToken(config, environment);

        return new ThomasNetworkBot(config, flowEngine, redisManager, whatsAppClientFactory,
                objectMapper, paymentGateway, translationService);
    }

}
