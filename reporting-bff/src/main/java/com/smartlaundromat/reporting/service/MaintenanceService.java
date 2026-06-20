package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class MaintenanceService {

    private final NamedParameterJdbcTemplate jdbc;

    public List<Map<String, Object>> activeAlerts() {
        return jdbc.queryForList("""
            SELECT id, machine_id, type, status, priority, description,
                   cost, is_alert, alert_acknowledged, created_at
            FROM ops.maintenance_records
            WHERE is_alert = TRUE AND alert_acknowledged = FALSE
            ORDER BY
              CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
              created_at DESC
            """, Map.of());
    }

    public List<Map<String, Object>> history(String machineId) {
        if (machineId != null) {
            return jdbc.queryForList("""
                SELECT * FROM ops.maintenance_records
                WHERE machine_id = :machineId
                ORDER BY created_at DESC
                """, Map.of("machineId", machineId));
        }
        return jdbc.queryForList("""
            SELECT * FROM ops.maintenance_records
            ORDER BY created_at DESC
            LIMIT 100
            """, Map.of());
    }

    public Map<String, Object> log(Map<String, Object> request) {
        var params = new MapSqlParameterSource()
            .addValue("machineId",   request.get("machineId"))
            .addValue("type",        request.getOrDefault("type", "CORRECTIVE"))
            .addValue("status",      request.getOrDefault("status", "OPEN"))
            .addValue("priority",    request.getOrDefault("priority", "NORMAL"))
            .addValue("description", request.get("description"))
            .addValue("cost",        request.get("cost"))
            .addValue("isAlert",     Boolean.TRUE.equals(request.get("isAlert")));

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.maintenance_records
              (machine_id, type, status, priority, description, cost, is_alert)
            VALUES
              (:machineId, :type, :status, :priority, :description, :cost, :isAlert)
            RETURNING id, machine_id, type, status, priority, description,
                      cost, is_alert, alert_acknowledged, created_at
            """, params);
        return result.isEmpty() ? Map.of() : result.get(0);
    }

    public Map<String, Object> acknowledgeAlert(Long id) {
        List<Map<String, Object>> result = jdbc.queryForList("""
            UPDATE ops.maintenance_records
            SET alert_acknowledged = TRUE, updated_at = NOW()
            WHERE id = :id
            RETURNING id, machine_id, alert_acknowledged, updated_at
            """, Map.of("id", id));
        return result.isEmpty() ? Map.of() : result.get(0);
    }
}
