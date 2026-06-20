package com.smartlaundromat.payment.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

@Data
@Configuration(proxyBeanMethods = false)
@ConfigurationProperties(prefix = "payment")
public class PaymentConfig {

    private String currency = "XAF";
    private int timeoutMinutes = 5;
    private Pricing pricing = new Pricing();
    private CampayConfig campay = new CampayConfig();
    private MtnConfig mtn = new MtnConfig();
    private OrangeConfig orange = new OrangeConfig();

    @Data
    public static class Pricing {
        private int shortCycle = 1000;
        private int longCycle = 2000;
    }

    @Data
    public static class CampayConfig {
        private String baseUrl;
        private String appKey;
        private String appSecret;
        private String webhookSecret;
    }

    @Data
    public static class MtnConfig {
        private String apiUrl;
        private String subscriptionKey;
        private String apiUserId;
        private String apiKey;
        private String environment = "sandbox";
    }

    @Data
    public static class OrangeConfig {
        private String apiUrl;
        private String clientId;
        private String clientSecret;
        private String merchantKey;
    }
}
