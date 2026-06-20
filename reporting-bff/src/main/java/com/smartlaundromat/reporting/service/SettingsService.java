package com.smartlaundromat.reporting.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class SettingsService {

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public Map<String, Object> getMachineConfig() {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT key, value::text AS value FROM ops.settings WHERE key IN ('program_pricing', 'maintenance_thresholds')",
            Map.of());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("warningCycles", 300);
        result.put("criticalCycles", 400);
        result.put("pricing", List.of());

        for (Map<String, Object> row : rows) {
            String key   = (String) row.get("key");
            String value = (String) row.get("value");
            try {
                if ("program_pricing".equals(key)) {
                    List<Map<String, Object>> pricing = objectMapper.readValue(value, new TypeReference<>() {});
                    result.put("pricing", pricing);
                } else if ("maintenance_thresholds".equals(key)) {
                    Map<String, Object> thresholds = objectMapper.readValue(value, new TypeReference<>() {});
                    result.put("warningCycles",  thresholds.getOrDefault("warning",  300));
                    result.put("criticalCycles", thresholds.getOrDefault("critical", 400));
                }
            } catch (Exception e) {
                // leave defaults if JSON is malformed
            }
        }
        return result;
    }

    public Map<String, Object> saveMachineConfig(List<Map<String, Object>> pricing,
                                                  int warningCycles,
                                                  int criticalCycles) {
        try {
            String pricingJson     = objectMapper.writeValueAsString(pricing);
            String thresholdsJson  = objectMapper.writeValueAsString(
                Map.of("warning", warningCycles, "critical", criticalCycles));

            jdbc.update("""
                INSERT INTO ops.settings (key, value, updated_at)
                VALUES ('program_pricing', :value::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                """, new MapSqlParameterSource("value", pricingJson));

            jdbc.update("""
                INSERT INTO ops.settings (key, value, updated_at)
                VALUES ('maintenance_thresholds', :value::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                """, new MapSqlParameterSource("value", thresholdsJson));

        } catch (Exception e) {
            throw new RuntimeException("Failed to save machine config: " + e.getMessage(), e);
        }

        return getMachineConfig();
    }
}
