package com.botmanager.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "payment")
public class PaymentProperties {

    private long ttlSeconds = 86400;

    private long pollIntervalMs = 10000;

    private long timeoutMs = 600000;

}
