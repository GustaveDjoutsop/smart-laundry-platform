package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "mqtt")
public class MqttProperties {

    private String url;

    private String username;

    private String password;

    private String topicPrefix;

    public boolean isConfigured() {
        return url != null && !url.isBlank();
    }

}
