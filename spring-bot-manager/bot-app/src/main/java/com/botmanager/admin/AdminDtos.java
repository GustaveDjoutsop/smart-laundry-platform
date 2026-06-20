package com.botmanager.admin;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.Map;

public final class AdminDtos {

    private AdminDtos() {
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BotConfigRequest {
        private String botId;
        private String botName;
        private String botType;
        private String phoneNumberId;
        private String verifyToken;
        private String accessToken;
        private String appSecret;
        private Map<String, Object> config;
        private Boolean enabled;
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BotConfigResponse {
        private String botId;
        private String botName;
        private String botType;
        private String phoneNumberId;
        private boolean hasVerifyToken;
        private boolean hasAccessToken;
        private boolean hasAppSecret;
        private Map<String, Object> config;
        private boolean enabled;
        private Instant createdAt;
        private Instant updatedAt;
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RefreshResponse {
        private int botsLoaded;
        private String message;
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ErrorResponse {
        private String error;
        private String detail;
    }
}