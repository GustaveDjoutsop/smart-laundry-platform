package com.botmanager.controller;

import com.botmanager.core.mqtt.MqttManager;
import com.botmanager.core.redis.RedisManager;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/health")
@RequiredArgsConstructor
public class HealthController {

    private final RedisManager redisManager;

    private final MqttManager mqttManager;

    @GetMapping
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "ok");
        response.put("timestamp", System.currentTimeMillis());

        Map<String, Object> services = new HashMap<>();
        services.put("redis", redisManager.isRedisAvailable() ? "connected" : "fallback");
        services.put("mqtt", mqttManager.isConnected() ? "connected" : "disconnected");
        response.put("services", services);

        return ResponseEntity.ok(response);
    }

}
