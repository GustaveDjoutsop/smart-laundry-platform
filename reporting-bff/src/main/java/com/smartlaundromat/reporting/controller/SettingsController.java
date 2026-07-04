package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.SettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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

    @GetMapping("/pricing")
    public List<Map<String, Object>> getCyclePricing() {
        return settingsService.getCyclePricing();
    }

    @PutMapping("/pricing/{key}")
    public Map<String, Object> updateCyclePricing(
            @PathVariable String key,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal Jwt jwt) {
        int amount = ((Number) body.getOrDefault("amount", 0)).intValue();
        String caller = jwt != null ? jwt.getSubject() : "dashboard";
        return settingsService.updateCyclePricing(key, amount, caller);
    }
}
