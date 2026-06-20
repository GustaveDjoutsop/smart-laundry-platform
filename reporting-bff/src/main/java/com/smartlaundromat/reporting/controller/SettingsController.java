package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.SettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/settings")
@RequiredArgsConstructor
public class SettingsController {

    private final SettingsService settingsService;

    @GetMapping("/machines")
    public Map<String, Object> getMachineConfig() {
        return settingsService.getMachineConfig();
    }

    @PutMapping("/machines")
    public Map<String, Object> saveMachineConfig(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> pricing = (List<Map<String, Object>>) body.getOrDefault("pricing", List.of());
        int warning  = ((Number) body.getOrDefault("warningCycles",  300)).intValue();
        int critical = ((Number) body.getOrDefault("criticalCycles", 400)).intValue();
        return settingsService.saveMachineConfig(pricing, warning, critical);
    }
}
