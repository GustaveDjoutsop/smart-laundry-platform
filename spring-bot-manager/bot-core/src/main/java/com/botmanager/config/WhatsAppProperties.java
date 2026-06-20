package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "whatsapp")
public class WhatsAppProperties {

    private Api api = new Api();

    private boolean verifySignature = false;

    private String appSecret;

    @Getter
    @Setter
    public static class Api {

        private String version = "v20.0";

        private String baseUrl = "https://graph.facebook.com";
    }

}
