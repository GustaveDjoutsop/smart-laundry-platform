package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "campay")
public class CamPayProperties {

    private String token;

    private String baseUrl = "https://www.campay.net/api";

    private String authScheme = "Token";

    private String collectPath = "/collect/";

    private String statusPath = "/transaction/";

    private String webhookSecret;

    private String webhookSignatureHeader = "x-campay-signature";

    public boolean isConfigured() {
        return token != null && !token.isBlank();
    }

}
