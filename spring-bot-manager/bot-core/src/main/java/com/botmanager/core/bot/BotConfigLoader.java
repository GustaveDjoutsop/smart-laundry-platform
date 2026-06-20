package com.botmanager.core.bot;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;

@Slf4j
public final class BotConfigLoader {

    private BotConfigLoader() {
    }

    public static <T extends BotConfig> T load(String configDirectory, String filename,
                                                Class<T> type, ObjectMapper mapper) {
        PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

        Resource resource = resolver.getResource("classpath:" + configDirectory + "/" + filename);
        if (!resource.exists()) {
            resource = resolver.getResource("file:" + configDirectory + "/" + filename);
        }

        if (!resource.exists()) {
            log.warn("Bot config file not found: {}/{}", configDirectory, filename);
            return null;
        }

        try {
            return mapper.readValue(resource.getInputStream(), type);
        } catch (IOException exception) {
            log.error("Failed to load bot config {}: {}", filename, exception.getMessage());
            return null;
        }
    }

    public static void resolveVerifyToken(BotConfig config, Environment environment) {
        String envKey = "VERIFY_TOKEN_" + config.getBotId().toUpperCase().replace("-", "_");
        String envToken = environment.getProperty(envKey);
        if (envToken != null && !envToken.isBlank()) {
            config.setVerifyToken(envToken);
        }
        if (config.getVerifyToken() == null || config.getVerifyToken().isBlank()) {
            log.warn("Bot {} has no verifyToken configured (set env var {})", config.getBotId(), envKey);
        }
    }

}
