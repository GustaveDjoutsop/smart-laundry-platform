package com.botmanager.core.bot;

import com.botmanager.config.RateLimitProperties;
import com.botmanager.core.flow.FlowDefinition;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;

@Getter
@Setter
public class BotConfig {

    private String botId;

    private String botName;

    private String botType;

    private String phoneNumberId;

    private String verifyToken;

    private String defaultFlowId;

    private Map<String, FlowDefinition> flows;

    /**
     * R11 — optional per-tenant override of {@link RateLimitProperties}'s global
     * whatsapp/payments limits, read by {@code RateLimitFilter}. Either sub-limit may be
     * omitted; an omitted one falls back to the global default for that category.
     */
    private RateLimitOverrides rateLimit;

    @Getter
    @Setter
    public static class RateLimitOverrides {

        private RateLimitProperties.EndpointLimit whatsapp;

        private RateLimitProperties.EndpointLimit payments;

    }

}
