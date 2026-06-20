package com.smartlaundromat.machine.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

import java.util.List;

@Data
@Configuration(proxyBeanMethods = false)
@ConfigurationProperties(prefix = "machine")
public class MachineConfig {

    private List<String> availableIds;
    private int heartbeatTimeoutSeconds = 120;
    private long cycleCheckIntervalMs = 60000;
}
