package com.smartlaundromat.machine.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

@Data
@Configuration(proxyBeanMethods = false)
@ConfigurationProperties(prefix = "mqtt")
public class MqttConfig {

    private String brokerUrl = "tcp://localhost:1883";
    private String clientId = "machine-state-service";
    private String username;
    private String password;
    private String topicPrefix = "laundry/cameroon";
    private int qos = 1;
    private int reconnectInterval = 5;

    public String getTelemetryTopic() {
        return topicPrefix + "/+/telemetry";
    }

    public String getCommandTopic(String machineId) {
        return topicPrefix + "/" + machineId + "/command";
    }
}
