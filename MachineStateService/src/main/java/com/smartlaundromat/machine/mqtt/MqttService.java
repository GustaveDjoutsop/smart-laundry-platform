package com.smartlaundromat.machine.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.machine.config.MqttConfig;
import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.service.MachineService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class MqttService implements MqttCallback {

    private final MqttConfig mqttConfig;
    private final ObjectMapper objectMapper;
    private MachineService machineService;
    private MqttClient mqttClient;

    public void setMachineService(MachineService machineService) {
        this.machineService = machineService;
    }

    @PostConstruct
    public void connect() {
        try {
            mqttClient = new MqttClient(
                    mqttConfig.getBrokerUrl(),
                    mqttConfig.getClientId(),
                    new MemoryPersistence()
            );

            MqttConnectOptions options = new MqttConnectOptions();
            options.setCleanSession(true);
            options.setAutomaticReconnect(true);
            options.setConnectionTimeout(10);
            options.setKeepAliveInterval(20);

            if (StringUtils.hasText(mqttConfig.getUsername())) {
                options.setUserName(mqttConfig.getUsername());
                options.setPassword(mqttConfig.getPassword().toCharArray());
            }

            mqttClient.setCallback(this);
            mqttClient.connect(options);

            mqttClient.subscribe(mqttConfig.getTelemetryTopic(), mqttConfig.getQos());
            log.info("Connected to MQTT broker: {}, subscribed to: {}",
                    mqttConfig.getBrokerUrl(), mqttConfig.getTelemetryTopic());

        } catch (MqttException e) {
            log.warn("Failed to connect to MQTT broker: {}. Will retry on next reconnect.", e.getMessage());
        }
    }

    @PreDestroy
    public void disconnect() {
        if (mqttClient != null && mqttClient.isConnected()) {
            try {
                mqttClient.disconnect();
                log.info("Disconnected from MQTT broker");
            } catch (MqttException e) {
                log.error("Error disconnecting from MQTT: {}", e.getMessage());
            }
        }
    }

    public void sendCommand(String machineId, String action, Integer pulseCount) {
        if (mqttClient == null || !mqttClient.isConnected()) {
            log.warn("MQTT client not connected, cannot send command to {}", machineId);
            return;
        }

        try {
            Map<String, Object> command = pulseCount != null
                    ? Map.of("action", action, "count", pulseCount)
                    : Map.of("action", action);

            String payload = objectMapper.writeValueAsString(command);
            String topic = mqttConfig.getCommandTopic(machineId);

            mqttClient.publish(topic, new MqttMessage(payload.getBytes(StandardCharsets.UTF_8)));
            log.info("Command sent to {}: {}", machineId, payload);

        } catch (Exception e) {
            log.error("Failed to send MQTT command to {}: {}", machineId, e.getMessage());
        }
    }

    @Override
    public void connectionLost(Throwable cause) {
        log.warn("MQTT connection lost: {}", cause.getMessage());
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        try {
            String machineId = extractMachineId(topic);
            String payload = new String(message.getPayload(), StandardCharsets.UTF_8);

            log.debug("Telemetry from {}: {}", machineId, payload);

            TelemetryPayload telemetry = objectMapper.readValue(payload, TelemetryPayload.class);
            telemetry.setMachineId(machineId);

            if (machineService != null) {
                machineService.processTelemetry(telemetry);
            }

        } catch (Exception e) {
            log.error("Error processing MQTT message from {}: {}", topic, e.getMessage());
        }
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
    }

    private String extractMachineId(String topic) {
        String[] parts = topic.split("/");
        return parts.length >= 3 ? parts[parts.length - 2] : "unknown";
    }

    public boolean isConnected() {
        return mqttClient != null && mqttClient.isConnected();
    }
}
