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
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.client.RestTemplate;

@Slf4j
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

        // Startup diagnostic — confirms which states are loaded from the JSON.
        // Look for this in Railway logs after each deploy.
        if (config.getFlows() != null && config.getFlows().get("laundry_flow") != null) {
            var states = config.getFlows().get("laundry_flow").getStates();
            log.info("LaundryBot laundry_flow loaded {} states: {}", states != null ? states.size() : 0,
                    states != null ? states.keySet() : "null");
        } else {
            log.warn("LaundryBot: laundry_flow not found in loaded config");
        }

        PricingClient pricingClient = new PricingClient(
                restTemplate,
                pmsBaseUrl,
                config.getShortCycle().getPrice(),
                config.getLongCycle().getPrice(),
                config.getReservation().getPrice());

        TransactionClient transactionClient = new TransactionClient(restTemplate, pmsBaseUrl);

        return new LaundryBot(config, flowEngine, redisManager, whatsAppClientFactory,
                objectMapper, paymentGateway, machineService, translationService, pricingClient, transactionClient);
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
