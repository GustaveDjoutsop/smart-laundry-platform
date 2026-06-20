package com.botmanager.admin;

import com.botmanager.core.bot.BotRegistryRefreshEvent;
import com.botmanager.core.persistence.entity.BusinessEntity;
import com.botmanager.core.persistence.repository.BusinessRepository;
import com.botmanager.core.bot.BotType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/admin/bots")
@RequiredArgsConstructor
public class AdminBotController {

    private final BusinessRepository businessRepository;
    private final ApplicationEventPublisher eventPublisher;

    @GetMapping
    public ResponseEntity<List<AdminDtos.BotConfigResponse>> listBots() {
        List<AdminDtos.BotConfigResponse> bots = businessRepository.findAll().stream()
                .map(this::toResponse)
                .toList();

        return ResponseEntity.ok(bots);
    }

    @GetMapping("/{botId}")
    public ResponseEntity<?> getBot(@PathVariable String botId) {
        return businessRepository.findByBotId(botId)
                .map(entity -> ResponseEntity.ok(toResponse(entity)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> createBot(@RequestBody AdminDtos.BotConfigRequest request) {
        if (!StringUtils.hasText(request.getBotId())) {
            return badRequest("botId is required");
        }

        if (!StringUtils.hasText(request.getPhoneNumberId())) {
            return badRequest("phoneNumberId is required");
        }

        if (businessRepository.existsByBotId(request.getBotId())) {
            return conflict("Bot with id '" + request.getBotId() + "' already exists");
        }

        if (businessRepository.existsByPhoneNumberId(request.getPhoneNumberId())) {
            return conflict("Bot with phoneNumberId '" + request.getPhoneNumberId() + "' already exists");
        }

        BusinessEntity entity = new BusinessEntity();
        applyRequest(entity, request, true);

        BusinessEntity saved = businessRepository.save(entity);
        log.info("Created admin bot config {}", saved.getBotId());

        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(saved));
    }

    @PutMapping("/{botId}")
    public ResponseEntity<?> updateBot(@PathVariable String botId, @RequestBody AdminDtos.BotConfigRequest request) {
        return businessRepository.findByBotId(botId)
                .map(entity -> {
                    if (StringUtils.hasText(request.getPhoneNumberId())
                            && !request.getPhoneNumberId().equals(entity.getPhoneNumberId())
                            && businessRepository.existsByPhoneNumberId(request.getPhoneNumberId())) {
                        return conflict("Bot with phoneNumberId '" + request.getPhoneNumberId() + "' already exists");
                    }

                    applyRequest(entity, request, false);
                    BusinessEntity saved = businessRepository.save(entity);
                    log.info("Updated admin bot config {}", saved.getBotId());
                    return ResponseEntity.ok(toResponse(saved));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{botId}/disable")
    public ResponseEntity<?> disableBot(@PathVariable String botId) {
        return businessRepository.findByBotId(botId)
                .map(entity -> {
                    entity.setActive(false);
                    businessRepository.save(entity);
                    return ResponseEntity.ok(Map.of(
                            "message", "Bot '" + botId + "' disabled. Call /admin/bots/refresh to publish a reload event."
                    ));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/refresh")
    public ResponseEntity<AdminDtos.RefreshResponse> refresh() {
        eventPublisher.publishEvent(new BotRegistryRefreshEvent(this));

        return ResponseEntity.ok(AdminDtos.RefreshResponse.builder()
                .botsLoaded(businessRepository.findByActiveTrue().size())
                .message("Refresh event published")
                .build());
    }

    private void applyRequest(BusinessEntity entity, AdminDtos.BotConfigRequest request, boolean creating) {
        if (creating) {
            entity.setBotId(request.getBotId());
            entity.setPhoneNumberId(request.getPhoneNumberId());
        }

        if (StringUtils.hasText(request.getBotName())) {
            entity.setName(request.getBotName());
        } else if (creating) {
            entity.setName(request.getBotId());
        }

        if (StringUtils.hasText(request.getBotType())) {
            // Validate that the provided botType is supported. BotType.fromValue will
            // throw an IllegalArgumentException (or similar) for unknown values.
            BotType.fromValue(request.getBotType());
            entity.setIndustry(request.getBotType());
        } else if (creating) {
            throw new IllegalArgumentException("botType is required when creating a bot");
        }

        if (!creating && StringUtils.hasText(request.getPhoneNumberId())) {
            entity.setPhoneNumberId(request.getPhoneNumberId());
        }

        if (request.getVerifyToken() != null) {
            entity.setVerifyToken(blankToNull(request.getVerifyToken()));
        }

        if (request.getAccessToken() != null) {
            entity.setAccessToken(blankToNull(request.getAccessToken()));
        }

        if (request.getAppSecret() != null) {
            entity.setAppSecret(blankToNull(request.getAppSecret()));
        }

        if (request.getEnabled() != null) {
            entity.setActive(request.getEnabled());
        } else if (creating) {
            entity.setActive(true);
        }

        entity.setConfig(buildConfig(entity, request.getConfig()));
    }

    private Map<String, Object> buildConfig(BusinessEntity entity, Map<String, Object> requestConfig) {
        Map<String, Object> config = new LinkedHashMap<>();
        if (requestConfig != null) {
            config.putAll(requestConfig);
        } else if (entity.getConfig() != null) {
            config.putAll(entity.getConfig());
        }

        config.put("botId", entity.getBotId());
        config.put("botName", entity.getName());
        config.put("botType", entity.getIndustry());
        config.put("phoneNumberId", entity.getPhoneNumberId());
        config.remove("verifyToken");
        config.remove("accessToken");
        config.remove("appSecret");

        return config;
    }

    private AdminDtos.BotConfigResponse toResponse(BusinessEntity entity) {
        return AdminDtos.BotConfigResponse.builder()
                .botId(entity.getBotId())
                .botName(entity.getName())
                .botType(entity.getIndustry())
                .phoneNumberId(entity.getPhoneNumberId())
                .hasVerifyToken(StringUtils.hasText(entity.getVerifyToken()))
                .hasAccessToken(StringUtils.hasText(entity.getAccessToken()))
                .hasAppSecret(StringUtils.hasText(entity.getAppSecret()))
                .config(sanitizeConfig(entity.getConfig()))
                .enabled(entity.isActive())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    private ResponseEntity<AdminDtos.ErrorResponse> badRequest(String detail) {
        return ResponseEntity.badRequest().body(
                AdminDtos.ErrorResponse.builder()
                        .error("Bad Request")
                        .detail(detail)
                        .build()
        );
    }

    private ResponseEntity<AdminDtos.ErrorResponse> conflict(String detail) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(
                AdminDtos.ErrorResponse.builder()
                        .error("Conflict")
                        .detail(detail)
                        .build()
        );
    }

    private String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }

    private Map<String, Object> sanitizeConfig(Map<String, Object> config) {
        if (config == null) {
            return null;
        }

        return config.entrySet().stream()
                .filter(entry -> !isSecretKey(entry.getKey()))
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        Map.Entry::getValue,
                        (left, right) -> right,
                        LinkedHashMap::new
                ));
    }

    private boolean isSecretKey(String key) {
        return "verifyToken".equals(key) || "accessToken".equals(key) || "appSecret".equals(key);
    }
}