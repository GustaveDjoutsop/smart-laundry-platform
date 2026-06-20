package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.StringUtils;

@Getter
@Setter
@ConfigurationProperties(prefix = "mqtt")
public class MqttProperties {

    private String url;

    private String username;

    private String password;

    private String topicPrefix;

    public boolean isConfigured() {
        return StringUtils.hasText(url);
    }

}
