package com.botmanager.core.mqtt;

import com.botmanager.config.MqttProperties;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hivemq.client.mqtt.MqttClient;
import com.hivemq.client.mqtt.mqtt3.Mqtt3AsyncClient;
import com.hivemq.client.mqtt.mqtt3.message.publish.Mqtt3Publish;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;

@Slf4j
@Component
@RequiredArgsConstructor
public class MqttManager {

    private final MqttProperties mqttProperties;

    private final ObjectMapper objectMapper;

    private Mqtt3AsyncClient client;

    private boolean connected = false;

    private final Map<String, List<BiConsumer<String, String>>> topicListeners = new ConcurrentHashMap<>();

    @PostConstruct
    void init() {
        if (!mqttProperties.isConfigured()) {
            log.info("MQTT not configured, skipping initialization");

            return;
        }

        try {
            URI uri = URI.create(mqttProperties.getUrl());
            String host = uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : 1883;

            var clientBuilder = MqttClient.builder()
                    .useMqttVersion3()
                    .identifier("spring-bot-manager-" + UUID.randomUUID().toString().substring(0, 8))
                    .serverHost(host)
                    .serverPort(port);

            if (mqttProperties.getUsername() != null && !mqttProperties.getUsername().isBlank()) {
                clientBuilder.simpleAuth()
                        .username(mqttProperties.getUsername())
                        .password(mqttProperties.getPassword().getBytes(StandardCharsets.UTF_8))
                        .applySimpleAuth();
            }

            client = clientBuilder.buildAsync();

            client.connectWith()
                    .send()
                    .whenComplete((ack, throwable) -> {
                        if (throwable != null) {
                            log.error("MQTT connection failed: {}", throwable.getMessage());
                        } else {
                            connected = true;
                            log.info("MQTT connected to {}", mqttProperties.getUrl());
                        }
                    });
        } catch (Exception exception) {
            log.error("MQTT initialization failed: {}", exception.getMessage());
        }
    }

    @PreDestroy
    void shutdown() {
        if (client != null && connected) {
            client.disconnect();
            log.info("MQTT disconnected");
        }
    }

    public boolean isConnected() {
        return connected;
    }

    public void subscribe(String topicPattern, BiConsumer<String, String> listener) {
        if (!connected || client == null) {
            log.warn("Cannot subscribe to {}, MQTT not connected", topicPattern);

            return;
        }

        topicListeners.computeIfAbsent(topicPattern, k -> new CopyOnWriteArrayList<>()).add(listener);

        client.subscribeWith()
                .topicFilter(topicPattern)
                .callback(this::handleMessage)
                .send()
                .whenComplete((ack, throwable) -> {
                    if (throwable != null) {
                        log.error("MQTT subscribe failed for {}: {}", topicPattern, throwable.getMessage());
                    } else {
                        log.info("MQTT subscribed to {}", topicPattern);
                    }
                });
    }

    public void publish(String topic, Object payload) {
        if (!connected || client == null) {
            log.warn("Cannot publish to {}, MQTT not connected", topic);

            return;
        }

        try {
            String message = objectMapper.writeValueAsString(payload);

            client.publishWith()
                    .topic(topic)
                    .payload(message.getBytes(StandardCharsets.UTF_8))
                    .send()
                    .whenComplete((ack, throwable) -> {
                        if (throwable != null) {
                            log.error("MQTT publish failed to {}: {}", topic, throwable.getMessage());
                        } else {
                            log.debug("MQTT published to {}", topic);
                        }
                    });
        } catch (JsonProcessingException exception) {
            log.error("Failed to serialize MQTT message: {}", exception.getMessage());
        }
    }

    private void handleMessage(Mqtt3Publish publish) {
        String topic = publish.getTopic().toString();
        String payload = new String(publish.getPayloadAsBytes(), StandardCharsets.UTF_8);

        log.debug("MQTT received on {}: {}", topic, payload);

        topicListeners.forEach((pattern, listeners) -> {
            if (topicMatches(pattern, topic)) {
                listeners.forEach(listener -> {
                    try {
                        listener.accept(topic, payload);
                    } catch (Exception exception) {
                        log.error("MQTT listener error for topic {}: {}", topic, exception.getMessage());
                    }
                });
            }
        });
    }

    private boolean topicMatches(String pattern, String topic) {
        String regex = pattern.replace("+", "[^/]+").replace("#", ".*");

        return topic.matches(regex);
    }

}
