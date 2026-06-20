package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitProperties {

    private EndpointLimit whatsapp = new EndpointLimit(60000, 120);

    private EndpointLimit payments = new EndpointLimit(60000, 120);

    @Getter
    @Setter
    public static class EndpointLimit {

        private long windowMs;

        private int maxRequests;

        public EndpointLimit() {
        }

        public EndpointLimit(long windowMs, int maxRequests) {
            this.windowMs = windowMs;
            this.maxRequests = maxRequests;
        }
    }

}
