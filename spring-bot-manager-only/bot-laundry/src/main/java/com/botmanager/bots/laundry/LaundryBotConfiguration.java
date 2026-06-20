package com.botmanager.bots.laundry;

import com.botmanager.config.BotProperties;
import com.botmanager.core.bot.BotConfigLoader;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.client.RestTemplate;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(LaundryBotProperties.class)
public class LaundryBotConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "smartbot.bots.laundry", name = "enabled",
            havingValue = "true", matchIfMissing = true)
    public LaundryBot laundryBot(BotProperties botProperties,
                                 FlowEngine flowEngine,
                                 RedisManager redisManager,
                                 WhatsAppClientFactory whatsAppClientFactory,
                                 ObjectMapper objectMapper,
                                 PaymentGateway paymentGateway,
                                 MachineService machineService,
                                 TranslationService translationService,
                                 LaundryBotProperties laundryBotProperties,
                                 RestTemplate restTemplate,
                                 @Value("${microservice.payment-service-url:http://localhost:8081}") String pmsBaseUrl,
                                 Environment environment) {

        LaundryBotConfig config = BotConfigLoader.load(
                botProperties.getConfigDirectory(), "laundry.bot.json",
                LaundryBotConfig.class, objectMapper);

        if (config == null) {
            return null;
        }

        BotConfigLoader.resolveVerifyToken(config, environment);
        applyYamlOverrides(config, laundryBotProperties);

        PricingClient pricingClient = new PricingClient(
                restTemplate,
                pmsBaseUrl,
                config.getShortCycle().getPrice(),
                config.getLongCycle().getPrice());

        return new LaundryBot(config, flowEngine, redisManager, whatsAppClientFactory,
                objectMapper, paymentGateway, machineService, translationService, pricingClient);
    }

    public static void applyYamlOverrides(LaundryBotConfig config, LaundryBotProperties props) {
        if (props == null) {
            return;
        }
        LaundryBotProperties.FeaturesOverride override = props.getFeatures();
        if (override.getWashFlowEnabled() != null) {
            config.getFeatures().setWashFlowEnabled(override.getWashFlowEnabled());
        }
        if (override.getReservationEnabled() != null) {
            config.getFeatures().setReservationEnabled(override.getReservationEnabled());
        }
    }

}
