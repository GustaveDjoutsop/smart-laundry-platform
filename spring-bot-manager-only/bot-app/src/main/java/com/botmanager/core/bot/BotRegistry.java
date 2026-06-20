package com.botmanager.core.bot;

import com.botmanager.bots.laundry.LaundryBotConfig;
import com.botmanager.bots.laundry.LaundryBotConfiguration;
import com.botmanager.bots.laundry.LaundryBotProperties;
import com.botmanager.config.BotProperties;
import com.botmanager.core.flow.FlowEngine;
import com.botmanager.core.i18n.TranslationService;
import com.botmanager.core.machine.MachineService;
import com.botmanager.core.payment.PaymentEventPublisher;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.persistence.entity.BusinessEntity;
import com.botmanager.core.persistence.repository.BusinessRepository;
import com.botmanager.core.redis.RedisManager;
import com.botmanager.core.whatsapp.WhatsAppClientFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.context.annotation.Primary;
import org.springframework.util.StringUtils;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@Primary
@RequiredArgsConstructor
public class BotRegistry extends BotLookup {

    private final BotProperties botProperties;

    private final FlowEngine flowEngine;

    private final RedisManager redisManager;

    private final WhatsAppClientFactory whatsAppClientFactory;

    private final PaymentGateway paymentGateway;

    private final MachineService machineService;

    private final TranslationService translationService;

    private final ObjectMapper objectMapper;

    private final Environment environment;

    @Autowired(required = false)
    private BusinessRepository businessRepository;

    @Autowired(required = false)
    private LaundryBotProperties laundryBotProperties;

    private final Map<String, BaseBot> botsByName = new ConcurrentHashMap<>();

    private final Map<String, BaseBot> botsByPhoneId = new ConcurrentHashMap<>();

    private final Map<String, String> verifyTokenToBot = new ConcurrentHashMap<>();

    @PostConstruct
    void init() {
        if (loadBotsFromDatabase()) {
            return;
        }

        loadBotsFromDirectory();
    }

    @EventListener
    public void onRefreshEvent(BotRegistryRefreshEvent event) {
        log.info("Received BotRegistry refresh event; reloading bots from database");
        reloadFromDatabase();
    }

    @EventListener
    public void onPaymentCompleted(PaymentEventPublisher.PaymentCompletedEvent event) {
        getBotByName(event.getRecord().getBotId())
                .ifPresent(bot -> bot.onPaymentCompleted(event.getRecord()));
    }

    @EventListener
    public void onPaymentFailed(PaymentEventPublisher.PaymentFailedEvent event) {
        getBotByName(event.getRecord().getBotId())
                .ifPresent(bot -> bot.onPaymentFailed(event.getRecord()));
    }

    public void registerBot(String name, BaseBot bot) {
        BotConfig config = bot.getConfig();

        BaseBot existing = botsByPhoneId.get(config.getPhoneNumberId());
        if (existing != null) {
            String existingBotId = existing.getConfig() != null ? existing.getConfig().getBotId() : "<unknown>";

            log.error(
                "Duplicate phoneNumberId '{}' for bot '{}'. Already registered to bot '{}'. " +
                    "Webhook routing uses metadata.phone_number_id, so each bot must have a unique phoneNumberId.",
                config.getPhoneNumberId(),
                config.getBotId(),
                existingBotId
            );

            return;
        }

        botsByName.put(name, bot);
        botsByPhoneId.put(config.getPhoneNumberId(), bot);
        if (StringUtils.hasText(config.getVerifyToken())) {
            verifyTokenToBot.put(config.getVerifyToken(), name);
        }

        log.info("Registered bot: {} (phoneNumberId: {})", name, config.getPhoneNumberId());
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
    public synchronized Optional<String> getBotNameByVerifyToken(String verifyToken) {
        return Optional.ofNullable(verifyTokenToBot.get(verifyToken));
    }

    public synchronized void reloadFromDatabase() {
        if (businessRepository == null) {
            log.warn("Business repository not available; skipping database reload");

            return;
        }

        try {
            List<BusinessEntity> dbConfigs = businessRepository.findByActiveTrue();
            if (dbConfigs.isEmpty()) {
                log.warn("No active bot configs found in database. Keeping current registry.");

                return;
            }

            clearRegistry();

            for (BusinessEntity entity : dbConfigs) {
                try {
                    loadBotFromEntity(entity);
                } catch (Exception exception) {
                    log.error("Failed to load bot {} from database: {}", entity.getBotId(), exception.getMessage());
                }
            }

            log.info("Registry reloaded from database with {} bots", botsByName.size());
        } catch (Exception exception) {
            log.error("Failed to reload bots from database: {}", exception.getMessage());
        }
    }

    private void loadBotsFromDirectory() {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

        String classpathPattern = "classpath:" + botProperties.getConfigDirectory() + "/*.bot.json";
        String filePattern = "file:" + botProperties.getConfigDirectory() + "/*.bot.json";

        Resource[] resources = new Resource[0];
        try {
            resources = resolver.getResources(classpathPattern);
        } catch (IOException exception) {
            log.debug("Classpath bot config scan failed ({}): {}", classpathPattern, exception.getMessage());
        }

        if (resources.length == 0) {
            try {
                resources = resolver.getResources(filePattern);
            } catch (IOException exception) {
                log.error("Failed to load bots from directory: {}", exception.getMessage());

                return;
            }
        }

        for (Resource resource : resources) {
            loadBotConfig(resource);
        }

        log.info("Loaded {} bots from directory", botsByName.size());
    }

    private boolean loadBotsFromDatabase() {
        if (businessRepository == null) {
            return false;
        }

        try {
            List<BusinessEntity> dbConfigs = businessRepository.findByActiveTrue();
            if (dbConfigs.isEmpty()) {
                return false;
            }

            log.info("Loading {} bots from database", dbConfigs.size());

            for (BusinessEntity entity : dbConfigs) {
                try {
                    loadBotFromEntity(entity);
                } catch (Exception exception) {
                    log.error("Failed to load bot {} from database: {}", entity.getBotId(), exception.getMessage());
                }
            }

            if (!botsByName.isEmpty()) {
                log.info("Loaded {} bots from database", botsByName.size());
                return true;
            }
        } catch (Exception exception) {
            log.warn("Database not available for bot loading, falling back to JSON files: {}", exception.getMessage());
        }

        clearRegistry();
        return false;
    }

    private void loadBotConfig(Resource resource) {
        try (InputStream inputStream = resource.getInputStream()) {
            // First pass: read as generic BotConfig to determine type
            byte[] configBytes = inputStream.readAllBytes();
            BotConfig baseConfig = objectMapper.readValue(configBytes, BotConfig.class);

            if (!validateBotConfig(baseConfig)) {
                log.warn("Invalid bot config: {}", resource.getFilename());

                return;
            }

            // Second pass: read as specific config type based on bot type
            BotConfig config = parseTypedConfig(configBytes, baseConfig.getBotType());

            // Resolve verifyToken from environment variable, falling back to JSON value
            resolveVerifyToken(config);

            BaseBot bot = createBotInstance(config);
            if (bot != null) {
                registerBot(config.getBotId(), bot);
            }
        } catch (Exception exception) {
            log.error("Failed to load bot config {}: {}", resource.getFilename(), exception.getMessage());
        }
    }

    private void loadBotFromEntity(BusinessEntity entity) {
        Map<String, Object> configMap = entity.getConfig() != null
                ? new LinkedHashMap<>(entity.getConfig())
                : new LinkedHashMap<>();
        configMap.put("botId", entity.getBotId());
        configMap.put("botName", entity.getName());
        configMap.put("botType", entity.getIndustry());
        configMap.put("phoneNumberId", entity.getPhoneNumberId());

        try {
            byte[] configBytes = objectMapper.writeValueAsBytes(configMap);
            BotConfig config = parseTypedConfig(configBytes, entity.getIndustry());
            config.setBotId(entity.getBotId());
            config.setBotName(entity.getName());
            config.setBotType(entity.getIndustry());
            config.setPhoneNumberId(entity.getPhoneNumberId());
            config.setVerifyToken(entity.getVerifyToken());
            resolveVerifyToken(config); // fallback to env var / YAML if not set in DB
            applyYamlOverrides(config);

            BaseBot bot = createBotInstance(config);
            if (bot != null) {
                registerBot(config.getBotId(), bot);
            }
        } catch (Exception exception) {
            log.error("Failed to deserialize bot {} from database: {}", entity.getBotId(), exception.getMessage());
        }
    }

    private BotConfig parseTypedConfig(byte[] configBytes, String botType) throws IOException {
        BotType type = BotType.fromValue(botType);

        if (type == null) {
            return objectMapper.readValue(configBytes, BotConfig.class);
        }

        return switch (type) {
            case LAUNDRY -> objectMapper.readValue(configBytes, LaundryBotConfig.class);
            case THOMAS_NETWORK -> objectMapper.readValue(configBytes, BotConfig.class);
        };
    }

    private boolean validateBotConfig(BotConfig config) {
        if (!StringUtils.hasText(config.getBotId())) {
            log.warn("Bot config missing botId");

            return false;
        }

        if (!StringUtils.hasText(config.getPhoneNumberId())) {
            log.warn("Bot {} missing phoneNumberId", config.getBotId());

            return false;
        }

        return true;
    }

    private void resolveVerifyToken(BotConfig config) {
        String envKey = "VERIFY_TOKEN_" + config.getBotId().toUpperCase().replace("-", "_");
        String envToken = environment.getProperty(envKey);
        if (StringUtils.hasText(envToken)) {
            config.setVerifyToken(envToken);
        }
        if (!StringUtils.hasText(config.getVerifyToken())) {
            log.warn("Bot {} has no verifyToken configured (set env var {})", config.getBotId(), envKey);
        }
    }

    private BaseBot createBotInstance(BotConfig config) {
        BotType botType = BotType.fromValue(config.getBotType());

        if (botType == null) {
            log.warn("Unknown bot type {} for bot {}", config.getBotType(), config.getBotId());

            return null;
        }

        return switch (botType) {
            case LAUNDRY -> new com.botmanager.bots.laundry.LaundryBot(
                    (LaundryBotConfig) config, flowEngine, redisManager, whatsAppClientFactory, objectMapper,
                    paymentGateway, machineService, translationService
            );
            case THOMAS_NETWORK -> new com.botmanager.bots.thomasnetwork.ThomasNetworkBot(
                    config, flowEngine, redisManager, whatsAppClientFactory, objectMapper,
                    paymentGateway, translationService
            );
        };
    }

    private void applyYamlOverrides(BotConfig config) {
        if (config instanceof LaundryBotConfig laundryConfig) {
            LaundryBotConfiguration.applyYamlOverrides(laundryConfig, laundryBotProperties);
        }
    }

    private void clearRegistry() {
        botsByName.clear();
        botsByPhoneId.clear();
        verifyTokenToBot.clear();
    }

}
