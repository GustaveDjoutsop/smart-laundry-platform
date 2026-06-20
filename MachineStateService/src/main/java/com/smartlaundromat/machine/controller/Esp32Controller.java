package com.smartlaundromat.machine.controller;

import com.smartlaundromat.machine.dto.TelemetryPayload;
import com.smartlaundromat.machine.mqtt.MqttService;
import com.smartlaundromat.machine.service.MachineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/esp32")
@RequiredArgsConstructor
@Slf4j
public class Esp32Controller {

    private final MachineService machineService;
    private final MqttService mqttService;

    @PostMapping("/telemetry")
    public ResponseEntity<Map<String, String>> receiveTelemetry(@RequestBody TelemetryPayload payload) {
        log.debug("HTTP telemetry from {}: status={}", payload.getMachineId(), payload.getStatus());
        machineService.processTelemetry(payload);
        return ResponseEntity.ok(Map.of("status", "received"));
    }

    @GetMapping("/mqtt/status")
    public ResponseEntity<Map<String, Object>> getMqttStatus() {
        return ResponseEntity.ok(Map.of(
                "connected", mqttService.isConnected()
        ));
    }
}
